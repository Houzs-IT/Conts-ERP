// Conts only (not part of Houzs's code): the cleaning team bills an outside client for cleaning jobs and records what
// the client pays (chew, 26 Nov 2026: "add cleaning job 选外面地址填的时候就可以开单了，然后 collection 他们记录，这些都会
// 自动连接我这边记账"). Property OS keeps the jobs; it forwards here, on the person's behalf, through the claims router.
//
// The books follow AutoCount's way for these clients (its I-2609-044 / OR-004339): one customer for every outside
// cleaning client, 300-C002 CLEANING CUSTOMER, the client's own name on each invoice; the income is the CLEANING item
// group's sales account (570-0000 CLEANING SERVICES INCOME, migration 0392).
//   • An invoice is a sales invoice issued at once: it posts Dr 300-C002 / Cr 570-0000 (scm/lib/post-si-revenue). One
//     invoice holds one job or a month of a client's jobs, one line per job.
//   • A payment is the invoice's payment with its draft receipt (scm/lib/si-payment-row); it posts nothing until finance
//     confirms the money on Official receipts, which posts Dr the bank / Cr 300-C002 and makes the receipt formal
//     (acc/receipt-confirm), exactly as a renovation payment.
// Office staff only (Property OS lets in whoever may add cleaning jobs):
//   POST /cleaning-invoices                  { key, customerName, phone?, address?, invoiceDate?, lines: [{ taskId, day, description, amountSen }] }
//                                            -> { invoice }; 201 new, 200 when this key's invoice exists
//   GET  /cleaning-invoices?ids=a,b          -> { invoices } with their payments and receipts
//   POST /cleaning-invoices/:id/payments     { paidAt, method: cash|transfer, amountSen, note?, slip? } -> { invoice }
//   GET  /cleaning-invoices/:id/payments/:paymentId/slip   the slip

import { companyDocPrefix, requireActiveCompanyId } from '../scm/lib/companyScope';
import { insertWithDocNoRetry } from '../scm/lib/doc-no';
import { todayMyt } from '../scm/lib/my-time';
import { buildItemRow, nextSiNumber, recomputeTotals } from '../scm/lib/si-from-do';
import { postSiRevenue } from '../scm/lib/post-si-revenue';
import { insertSiPaymentRow } from '../scm/lib/si-payment-row';
import { recomputeSiPaid } from '../scm/lib/si-order-deposit';
import { postUnpostedSiPayments } from '../acc/payments';
import { decodeFiles, fileResponse, storeFiles } from './claims-files';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
type Db = any;

export const CLEANING_DEBTOR = '300-C002';
export const CLEANING_GROUP = 'CLEANING';
/** sales_invoices.ref of an invoice made here: what tells a cleaning invoice from any other. */
export const CLEANING_REF = 'CLEANING';
const MAX_LINES = 200;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const KEY = /^[A-Za-z0-9:_-]{8,80}$/;
const METHODS = new Set(['cash', 'transfer']);
const SLIP_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const INVOICE_COLS = 'id, invoice_number, invoice_date, debtor_name, phone, address1, total_sen, paid_sen, status, customer_so_no';

const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const officeOnly = (c: Ctx) => ((c.get('staff') as Staff).field ? c.json({ error: 'forbidden', message: 'Cleaning invoices are made by the office.' }, 403) : null);
const text = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

export type CleaningLine = { taskId: string; day: string; description: string; amountSen: number };

/** The lines as sent, or why they cannot be billed. */
export function cleaningLines(raw: unknown): { ok: true; lines: CleaningLine[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, message: 'Pick the cleaning jobs to bill.' };
  if (raw.length > MAX_LINES) return { ok: false, message: `At most ${MAX_LINES} jobs on one invoice.` };
  const seen = new Set<string>();
  const lines: CleaningLine[] = [];
  for (const r of raw as Array<Record<string, unknown> | null>) {
    const taskId = text(r?.taskId, 80);
    const day = text(r?.day, 10);
    const description = text(r?.description, 200);
    const amountSen = Number(r?.amountSen);
    if (!taskId) return { ok: false, message: 'A job is missing.' };
    if (seen.has(taskId)) return { ok: false, message: 'A job is on the invoice twice.' };
    seen.add(taskId);
    if (!DAY.test(day)) return { ok: false, message: 'A job has no day.' };
    if (!description) return { ok: false, message: 'A job has no description.' };
    if (!Number.isSafeInteger(amountSen) || amountSen <= 0) return { ok: false, message: `${description}: the amount must be more than RM 0.00.` };
    lines.push({ taskId, day, description, amountSen });
  }
  return { ok: true, lines };
}

/** Finance's set-up a cleaning invoice needs: the customer 300-C002 and the CLEANING group's income account. */
async function setUpRefusal(sb: Db, companyId: number): Promise<string | null> {
  const [d, g] = await Promise.all([
    sb.from('debtors').select('code, is_active').eq('company_id', companyId).eq('code', CLEANING_DEBTOR).maybeSingle(),
    sb.from('acc_item_group_accounts').select('sales_account').eq('company_id', companyId).eq('group_code', CLEANING_GROUP).maybeSingle(),
  ]);
  if (d.error || g.error) return 'The finance set-up could not be read. Try again in a moment.';
  if (!d.data || (d.data as { is_active?: boolean }).is_active === false) return `Finance has not set up the customer ${CLEANING_DEBTOR} CLEANING CUSTOMER yet.`;
  if (!(g.data as { sales_account?: string } | null)?.sales_account) return 'Finance has not set the cleaning income account yet.';
  return null;
}

type InvoiceRow = { id: string; invoice_number: string; invoice_date: string; debtor_name: string; phone: string | null; address1: string | null; total_sen: number; paid_sen: number; status: string; customer_so_no: string | null };

/** The invoices with their lines, payments and receipts, as the cleaning page shows them. */
export async function cleaningInvoices(sb: Db, companyId: number, ids: string[]): Promise<{ ok: true; invoices: unknown[] } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true, invoices: [] };
  const inv = await sb.from('sales_invoices').select(INVOICE_COLS).eq('company_id', companyId).eq('ref', CLEANING_REF).in('id', ids);
  if (inv.error) return { ok: false, error: inv.error.message };
  const rows = (inv.data ?? []) as InvoiceRow[];
  if (rows.length === 0) return { ok: true, invoices: [] };
  const found = rows.map(r => r.id);
  const [items, pays] = await Promise.all([
    sb.from('sales_invoice_items').select('sales_invoice_id, description, line_total_sen, line_delivery_date, notes, line_no').in('sales_invoice_id', found),
    sb.from('sales_invoice_payments').select('id, sales_invoice_id, paid_at, method, amount_sen, note, slip_key, created_at').in('sales_invoice_id', found),
  ]);
  if (items.error || pays.error) return { ok: false, error: (items.error ?? pays.error).message };
  const payRows = (pays.data ?? []) as Array<{ id: string; sales_invoice_id: string; paid_at: string; method: string; amount_sen: number; note: string | null; slip_key: string | null; created_at: string }>;
  const receipts = payRows.length
    ? await sb.from('acc_official_receipts').select('payment_id, or_number, status').eq('company_id', companyId).eq('payment_source', 'SIPAY').in('payment_id', payRows.map(p => p.id))
    : { data: [], error: null };
  if (receipts.error) return { ok: false, error: receipts.error.message };
  const receiptOf = new Map(((receipts.data ?? []) as Array<{ payment_id: string; or_number: string; status: string }>).map(r => [String(r.payment_id), r]));
  return {
    ok: true,
    invoices: rows.map(r => {
      const lines = ((items.data ?? []) as Array<{ sales_invoice_id: string; description: string | null; line_total_sen: number; line_delivery_date: string | null; notes: string | null; line_no: number | null }>)
        .filter(i => i.sales_invoice_id === r.id).sort((a, b) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0))
        .map(i => ({ taskId: String(i.notes ?? '').replace(/^task:/, '') || null, day: i.line_delivery_date, description: i.description ?? '', amountSen: Number(i.line_total_sen) }));
      const payments = payRows.filter(p => p.sales_invoice_id === r.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(p => {
        const rc = receiptOf.get(p.id);
        return {
          id: p.id, paidAt: p.paid_at, method: p.method, amountSen: Number(p.amount_sen), note: p.note, hasSlip: !!p.slip_key,
          receiptNo: rc?.or_number ?? null, receiptStatus: rc?.status ?? null, confirmed: rc?.status === 'FORMAL',
        };
      });
      const confirmedSen = payments.filter(p => p.confirmed).reduce((n, p) => n + p.amountSen, 0);
      const recordedSen = payments.filter(p => p.receiptStatus !== 'CANCELLED').reduce((n, p) => n + p.amountSen, 0);
      return {
        id: r.id, invoiceNo: r.invoice_number, invoiceDate: r.invoice_date, customerName: r.debtor_name, phone: r.phone, address: r.address1,
        totalSen: Number(r.total_sen), recordedSen, confirmedSen, outstandingSen: Math.max(0, Number(r.total_sen) - recordedSen),
        status: r.status, lines, payments,
      };
    }),
  };
}

const oneInvoice = async (c: Ctx, sb: Db, companyId: number, id: string, status = 200): Promise<Response> => {
  const r = await cleaningInvoices(sb, companyId, [id]);
  if (!r.ok) return c.json({ error: 'load_failed', message: r.error }, 500);
  return c.json({ invoice: r.invoices[0] ?? null }, status);
};

export const createCleaningInvoiceHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const refused = officeOnly(c);
  if (refused) return refused;
  const staff: Staff = c.get('staff');
  const sb = c.get('supabase');
  const b = await bodyOf(c);
  if (!b) return c.json({ error: 'invalid_json' }, 400);
  const key = text(b.key, 80);
  if (!KEY.test(key)) return c.json({ error: 'validation', message: 'The invoice has no key.' }, 422);
  const customerName = text(b.customerName, 120);
  if (!customerName) return c.json({ error: 'validation', message: 'Enter the client\'s name.' }, 422);
  const invoiceDate = b.invoiceDate == null || b.invoiceDate === '' ? todayMyt() : text(b.invoiceDate, 10);
  if (!DAY.test(invoiceDate)) return c.json({ error: 'validation', message: 'The invoice date is not a date.' }, 422);
  if (invoiceDate > todayMyt()) return c.json({ error: 'validation', message: 'The invoice date cannot be after today.' }, 422);
  const parsed = cleaningLines(b.lines);
  if (!parsed.ok) return c.json({ error: 'validation', message: parsed.message }, 422);

  /* The same jobs sent again (a retry, a double tap) answer with the invoice already made. */
  const existing = await sb.from('sales_invoices').select('id').eq('company_id', co.companyId).eq('ref', CLEANING_REF).eq('customer_so_no', key).neq('status', 'CANCELLED').maybeSingle();
  if (existing.error) return c.json({ error: 'load_failed', message: existing.error.message }, 500);
  if (existing.data) return oneInvoice(c, sb, co.companyId, String((existing.data as { id: string }).id));

  const notSetUp = await setUpRefusal(sb, co.companyId);
  if (notSetUp) return c.json({ error: 'not_set_up', message: notSetUp }, 409);

  const now = new Date().toISOString();
  const { data: head, error } = await insertWithDocNoRetry<{ id: string; invoice_number: string }>(
    () => nextSiNumber(sb, companyDocPrefix(c)),
    no => sb.from('sales_invoices').insert({
      company_id: co.companyId, invoice_number: no, debtor_code: CLEANING_DEBTOR, debtor_name: customerName, invoice_date: invoiceDate,
      phone: text(b.phone, 40) || null, address1: text(b.address, 300) || null, ref: CLEANING_REF, customer_so_no: key,
      currency: 'MYR', status: 'SENT', sent_at: now, confirmed_at: now, created_by: staff.userId,
      notes: `Cleaning jobs billed by ${staff.name || 'the cleaning team'}.`.slice(0, 500),
    }).select('id, invoice_number').single(),
  );
  if (error || !head) return c.json({ error: 'save_failed', message: error?.message ?? 'insert returned nothing' }, 500);
  const rows = parsed.lines.map((l, i) => ({
    ...buildItemRow(head.id, { itemCode: CLEANING_GROUP, itemGroup: CLEANING_GROUP, description: l.description, qty: 1, unitPriceSen: l.amountSen, uom: 'JOB', lineDeliveryDate: l.day, notes: `task:${l.taskId}` }, i + 1),
    company_id: co.companyId,
  }));
  const ins = await sb.from('sales_invoice_items').insert(rows);
  if (ins.error) {
    await sb.from('sales_invoices').delete().eq('id', head.id);
    return c.json({ error: 'save_failed', message: ins.error.message }, 500);
  }
  await recomputeTotals(sb, head.id);
  /* Dr 300-C002 / Cr the cleaning income. A refusal leaves the invoice issued and unposted, by name, for finance's
     re-post (Self-check); it never takes the invoice back. */
  const posted = await postSiRevenue(sb, head.invoice_number);
  if (!posted.ok) console.error('[cleaning-invoice] revenue not posted:', head.invoice_number, posted.status, posted.reason); // eslint-disable-line no-console
  return oneInvoice(c, sb, co.companyId, head.id, 201);
};

export const listCleaningInvoicesHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const refused = officeOnly(c);
  if (refused) return refused;
  const ids = [...new Set(String(c.req.query('ids') ?? '').split(',').map(s => s.trim()).filter(s => /^[0-9a-f-]{36}$/i.test(s)))].slice(0, 200);
  const r = await cleaningInvoices(c.get('supabase'), co.companyId, ids);
  if (!r.ok) return c.json({ error: 'load_failed', message: r.error }, 500);
  return c.json({ invoices: r.invoices });
};

export const recordCleaningPaymentHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const refused = officeOnly(c);
  if (refused) return refused;
  const staff: Staff = c.get('staff');
  const sb = c.get('supabase');
  const id = String(c.req.param('id'));
  const b = await bodyOf(c);
  if (!b) return c.json({ error: 'invalid_json' }, 400);
  const { data: inv, error } = await sb.from('sales_invoices').select('id, invoice_number, status, total_sen').eq('company_id', co.companyId).eq('ref', CLEANING_REF).eq('id', id).maybeSingle();
  if (error) return c.json({ error: 'load_failed', message: error.message }, 500);
  if (!inv) return c.json({ error: 'not_found', message: 'That cleaning invoice is not there.' }, 404);
  if (inv.status === 'CANCELLED') return c.json({ error: 'cancelled', message: `${inv.invoice_number} is cancelled.` }, 409);

  const paidAt = text(b.paidAt, 10);
  const method = text(b.method, 20);
  const amountSen = Number(b.amountSen);
  if (!DAY.test(paidAt)) return c.json({ error: 'validation', message: 'Enter the day the client paid.' }, 422);
  if (paidAt > todayMyt()) return c.json({ error: 'validation', message: 'The day paid cannot be after today.' }, 422);
  if (!METHODS.has(method)) return c.json({ error: 'validation', message: 'Pick cash or bank transfer.' }, 422);
  if (!Number.isSafeInteger(amountSen) || amountSen <= 0) return c.json({ error: 'validation', message: 'Enter the amount paid.' }, 422);
  /* One customer holds every outside client, so money past this invoice would sit as a credit another client's
     invoice could take: the most a payment takes is what the invoice still has open. */
  const view = await cleaningInvoices(sb, co.companyId, [id]);
  if (!view.ok) return c.json({ error: 'load_failed', message: view.error }, 500);
  const open = Number((view.invoices[0] as { outstandingSen?: number } | undefined)?.outstandingSen ?? 0);
  if (amountSen > open) return c.json({ error: 'over_invoice', message: open > 0 ? `${inv.invoice_number} has RM ${(open / 100).toFixed(2)} left to pay.` : `${inv.invoice_number} is paid in full.` }, 409);

  let slip: { slip_key: string; slip_name: string; slip_mime: string } | null = null;
  if (b.slip != null) {
    const files = decodeFiles([b.slip], 'slip');
    if (!files.ok) return c.json({ error: files.error, message: files.message }, files.status);
    const f = files.files[0];
    if (!SLIP_MIMES.has(f.mime)) return c.json({ error: 'validation', message: 'The slip must be a photo or a PDF.' }, 422);
    const bucket = c.env?.SLIPS;
    if (!bucket) return c.json({ error: 'not_set_up', message: 'Slips cannot be kept on this environment yet.' }, 503);
    const [stored] = await storeFiles(bucket, `cleaning-slips/${id}`, [f]);
    slip = { slip_key: stored.r2_key, slip_name: stored.file_name, slip_mime: stored.mime };
  } else if (method === 'transfer') {
    return c.json({ error: 'validation', message: 'Attach the transfer slip.' }, 422);
  }

  const { data: pay, error: pErr } = await insertSiPaymentRow(sb, {
    salesInvoiceId: id, companyId: co.companyId, paidAt, method, amountSen, note: text(b.note, 300) || null, createdBy: staff.userId,
  });
  if (pErr || !pay) return c.json({ error: 'save_failed', message: pErr?.message ?? 'insert returned nothing' }, 500);
  if (slip) await sb.from('sales_invoice_payments').update(slip).eq('id', (pay as { id: string }).id);
  await recomputeSiPaid(sb, id);
  /* Waits for finance (acc/payments confirmedMoney): nothing posts until the money is confirmed. */
  await postUnpostedSiPayments(sb, id);
  return oneInvoice(c, sb, co.companyId, id, 201);
};

export const cleaningSlipHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const refused = officeOnly(c);
  if (refused) return refused;
  const sb = c.get('supabase');
  const { data: inv } = await sb.from('sales_invoices').select('id').eq('company_id', co.companyId).eq('ref', CLEANING_REF).eq('id', String(c.req.param('id'))).maybeSingle();
  if (!inv) return c.json({ error: 'not_found', message: 'That cleaning invoice is not there.' }, 404);
  const { data: p } = await sb.from('sales_invoice_payments').select('slip_key, slip_name, slip_mime').eq('sales_invoice_id', inv.id).eq('id', String(c.req.param('paymentId'))).maybeSingle();
  if (!p?.slip_key) return c.json({ error: 'not_found', message: 'This payment has no slip.' }, 404);
  const obj = await c.env?.SLIPS?.get(p.slip_key);
  if (!obj) return c.json({ error: 'not_found', message: 'The slip file is gone.' }, 404);
  return fileResponse(obj, p.slip_name ?? 'slip', p.slip_mime ?? 'application/octet-stream');
};

export function cleaningBillingRoutes(r: { get: (p: string, h: (c: Ctx) => Promise<Response>) => unknown; post: (p: string, h: (c: Ctx) => Promise<Response>) => unknown }): void {
  r.post('/cleaning-invoices', createCleaningInvoiceHandler);
  r.get('/cleaning-invoices', listCleaningInvoicesHandler);
  r.post('/cleaning-invoices/:id/payments', recordCleaningPaymentHandler);
  r.get('/cleaning-invoices/:id/payments/:paymentId/slip', cleaningSlipHandler);
}
