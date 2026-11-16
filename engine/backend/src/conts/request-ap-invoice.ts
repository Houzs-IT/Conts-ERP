// Conts only (not part of Houzs's code): a payment request becomes an AP invoice, a quotation is booked first, and the
// balance is asked from the deposit request (chew, 15 Nov 2026; spec
// docs/superpowers/specs/2026-11-15-request-to-ap-invoice-design.md).
//   POST /accounting/payment-requests/:id/ap-invoice  { debitAccountCode?, provisional? }  a DRAFT bill from the request
//   POST /requests/:id/balance                        { note?, wantedOn?, files? }          the requester asks for the
//                                                                                        rest of a paid deposit's bill
// A request paid through a bill (payment_requests.ap_invoice_id) is paid on the Payment voucher page, against the bill;
// its status follows the bill (claims-voucher-hooks.ts settleRequest). The request the bill was made from follows the
// bill's lines (afterBillSavedBestEffort); what was first asked is kept (asked_lines).
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { docMonthTag, insertWithDocNoRetry, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { todayMyt } from '../scm/lib/my-time';
import { decodeFiles, removeFiles, storeFiles } from './claims-files';
import { settleRequest, settleRequestsOfBillBestEffort } from './claims-voucher-hooks';
import { spreadSen } from './payment-requests';
import { requestPayments } from './request-vouchers';
import { copyPapers, toBill } from './copy-papers';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
type Db = any;
const now = () => new Date().toISOString();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN = new Set(['SUBMITTED', 'PART_PAID']);
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };

type ReqLine = { id: string; department: string; sub_department_id?: string | null; unit_id: string | null; maintenance_issue_id: string | null; project_id: number | null; account_code: string | null; amount_sen: number; description: string | null; sort: number };
type BillLine = { id: string; line_no: number; description: string | null; debit_account_code: string; amount_sen: number; department: string | null; project_id: number | null; sub_department_id: string | null; unit_id: string | null; source_request_line_id: string | null };
const BILL_LINE = 'id, line_no, description, debit_account_code, amount_sen, department, project_id, sub_department_id, unit_id, source_request_line_id';

/** The live bill a request is paid through, or null: withdraw, reject, send again, Make voucher and a supplier change
 *  refuse a request that has one (change the bill, or cancel it first). */
export async function liveBillOf(sb: Db, requestId: string): Promise<{ id: string; invoiceNumber: string } | null> {
  const { data: q } = await sb.from('payment_requests').select('ap_invoice_id').eq('id', requestId).maybeSingle();
  const billId = (q as { ap_invoice_id?: string | null } | null)?.ap_invoice_id;
  if (!billId) return null;
  const { data: bill } = await sb.from('ap_invoices').select('id, invoice_number, status').eq('id', billId).maybeSingle();
  const b = bill as { id: string; invoice_number: string; status: string } | null;
  return b && b.status !== 'CANCELLED' ? { id: b.id, invoiceNumber: b.invoice_number } : null;
}

/** The refusal for a request paid through a live bill. */
export const billRefusal = (c: Ctx, bill: { invoiceNumber: string }) =>
  c.json({ error: 'has_ap_invoice', message: `This request is paid through AP invoice ${bill.invoiceNumber}. Change the AP invoice, or cancel it first.` }, 409);

/** After a bill is saved: the PAYMENT request it was made from takes the bill's lines and total (chew, 15 Nov 2026:
 *  自动更新 — description, amount, project, unit, lines added or taken off); the first time, what was asked is kept in
 *  asked_lines. A deposit stays the deposit. Then every request paid through the bill settles again. Best effort. */
export async function afterBillSavedBestEffort(sb: Db, billId: string): Promise<void> {
  try {
    const { data: bill } = await sb.from('ap_invoices').select('id, status, total_sen, payment_request_id').eq('id', billId).maybeSingle();
    const b = bill as { id: string; status: string; total_sen: number; payment_request_id: string | null } | null;
    if (b && b.status !== 'CANCELLED' && b.payment_request_id) await followBill(sb, b);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] the request of AP invoice ${billId} did not follow it:`, (e as Error).message);
  }
  await settleRequestsOfBillBestEffort(sb, billId);
}

async function followBill(sb: Db, b: { id: string; total_sen: number; payment_request_id: string | null }): Promise<void> {
  const { data: q } = await sb.from('payment_requests').select('id, type, status, amount_sen, ap_invoice_id, asked_lines').eq('id', b.payment_request_id).maybeSingle();
  const req = q as { id: string; type: string; status: string; amount_sen: number; ap_invoice_id: string | null; asked_lines: unknown } | null;
  if (!req || req.type !== 'PAYMENT' || req.ap_invoice_id !== b.id || (!OPEN.has(req.status) && req.status !== 'PAID')) return;
  const [{ data: billRows, error: bErr }, { data: reqRows, error: rErr }] = await Promise.all([
    sb.from('ap_invoice_lines').select(BILL_LINE).eq('invoice_id', b.id).order('line_no'),
    sb.from('payment_request_lines').select('*').eq('request_id', req.id),
  ]);
  if (bErr) throw new Error(bErr.message);
  if (rErr) throw new Error(rErr.message);
  const billLines = ((billRows ?? []) as BillLine[]).sort((x, y) => x.line_no - y.line_no);
  const had = ((reqRows ?? []) as ReqLine[]).sort((x, y) => x.sort - y.sort);
  if (billLines.length === 0) return;
  const total = billLines.reduce((n, l) => n + Number(l.amount_sen), 0);
  const same = had.length === billLines.length && Number(req.amount_sen) === total && billLines.every((l, i) => {
    const h = had[i]!;
    return h.id === l.source_request_line_id && Number(h.amount_sen) === Number(l.amount_sen) && (h.description ?? '') === (l.description ?? '')
      && String(h.project_id ?? '') === String(l.project_id ?? '') && String(h.unit_id ?? '') === String(l.unit_id ?? '')
      && String(h.sub_department_id ?? '') === String(l.sub_department_id ?? '');
  });
  if (same) return;

  const byId = new Map(had.map(h => [h.id, h]));
  const taken = new Set<string>();
  const rows = billLines.map((l, i) => {
    const keep = l.source_request_line_id && byId.has(l.source_request_line_id) && !taken.has(l.source_request_line_id) ? l.source_request_line_id : null;
    const id = keep ?? crypto.randomUUID();
    taken.add(id);
    const old = keep ? byId.get(keep)! : null;
    return {
      bill: l,
      row: {
        id, request_id: req.id, department: l.department ?? old?.department ?? 'supply', sub_department_id: l.sub_department_id ?? null,
        unit_id: l.unit_id ?? null, maintenance_issue_id: old?.maintenance_issue_id ?? null, project_id: l.project_id ?? null,
        account_code: l.debit_account_code, amount_sen: Number(l.amount_sen), description: l.description ?? null, sort: i,
      },
    };
  });
  const patch: Record<string, unknown> = { amount_sen: total, updated_at: now() };
  if (req.asked_lines == null) {
    patch.asked_lines = had.map(h => ({ department: h.department, subDepartmentId: h.sub_department_id ?? null, unitId: h.unit_id, maintenanceIssueId: h.maintenance_issue_id,
      projectId: h.project_id, amountSen: Number(h.amount_sen), description: h.description }));
    patch.asked_amount_sen = Number(req.amount_sen);
  }
  const gone = await sb.from('payment_request_lines').delete().eq('request_id', req.id);
  if (gone.error) throw new Error(gone.error.message);
  const ins = await sb.from('payment_request_lines').insert(rows.map(r => r.row));
  if (ins.error) throw new Error(ins.error.message);
  const up = await sb.from('payment_requests').update(patch).eq('id', req.id);
  if (up.error) throw new Error(up.error.message);
  /* A bill line that named no request line now has one: the next save keeps it. */
  for (const r of rows) {
    if (r.bill.source_request_line_id !== r.row.id) await sb.from('ap_invoice_lines').update({ source_request_line_id: r.row.id }).eq('id', r.bill.id);
  }
}

/** A cancelled bill lets go of every request paid through it: each is paid by its own vouchers again, or gets a new
 *  bill. Best effort. */
export async function releaseRequestsOfBillBestEffort(sb: Db, billId: string): Promise<void> {
  try {
    const { data } = await sb.from('payment_requests').select('id').eq('ap_invoice_id', billId);
    for (const r of (data ?? []) as Array<{ id: string }>) {
      await sb.from('payment_requests').update({ ap_invoice_id: null, ap_paid_before_sen: 0, updated_at: now() }).eq('id', r.id).eq('ap_invoice_id', billId);
      await settleRequest(sb, r.id);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] letting go of the requests of AP invoice ${billId} failed:`, (e as Error).message);
  }
}

type BillableRequest = { id: string; request_no: string; type: string; status: string; supplier_id: string | null; payee_to_check: boolean; wanted_on: string | null; note: string | null; ap_invoice_id: string | null };

/** A request an AP invoice may be made from (chew, 15 Nov 2026): a payment while it is open with no voucher; a deposit
 *  while open or once paid (its quotation, booked first). Not one that already has a live bill. The refusal otherwise. */
export async function billableRequest(c: Ctx, sb: Db, companyId: number, requestId: string): Promise<{ ok: true; r: BillableRequest } | { ok: false; res: Response }> {
  const { data: q } = await sb.from('payment_requests').select('id, request_no, type, status, supplier_id, payee_to_check, wanted_on, note, ap_invoice_id')
    .eq('company_id', companyId).eq('id', requestId).maybeSingle();
  const r = q as BillableRequest | null;
  if (!r) return { ok: false, res: c.json({ error: 'not_found', message: 'That payment request was not found.' }, 404) };
  const bill = await liveBillOf(sb, r.id);
  if (bill) return { ok: false, res: c.json({ error: 'bill_exists', message: `${r.request_no} already has AP invoice ${bill.invoiceNumber}.`, apInvoiceId: bill.id }, 409) };
  const deposit = r.type === 'DEPOSIT';
  if (deposit ? !(OPEN.has(r.status) || r.status === 'PAID') : !OPEN.has(r.status)) {
    return { ok: false, res: c.json({ error: 'not_open', message: deposit ? `${r.request_no}: this deposit request is not open or paid.` : `${r.request_no} is not waiting for payment.` }, 409) };
  }
  if (!deposit) {
    const { vouchers } = await requestPayments(sb, [r.id]);
    if ((vouchers.get(r.id) ?? []).some(p => p.status !== 'CANCELLED')) {
      return { ok: false, res: c.json({ error: 'voucher_exists', message: `A voucher already pays ${r.request_no}. Cancel it first.` }, 409) };
    }
  }
  return { ok: true, r };
}

/** The request takes the bill just made (only if it has none: a second save loses, and its draft goes), the bill's
 *  supplier when the payee was typed in, and its papers are copied onto the bill. The refusal otherwise. */
export async function linkBillToRequest(c: Ctx, sb: Db, companyId: number, r: BillableRequest, inv: { id: string; supplier_id?: string | null }): Promise<Response | null> {
  const patch: Record<string, unknown> = { ap_invoice_id: inv.id, ap_paid_before_sen: 0, updated_at: now() };
  /* A payee typed in is the supplier finance chose on the bill (chew, 16 Nov 2026: 财务这里也可以自行选). */
  if (!r.supplier_id && inv.supplier_id) {
    const { data: s } = await sb.from('suppliers').select('id, name').eq('company_id', companyId).eq('id', inv.supplier_id).maybeSingle();
    if (s) Object.assign(patch, { supplier_id: (s as { id: string }).id, payee_name: (s as { name: string }).name, payee_to_check: false });
  }
  /* (A cancelled bill it still names counts as none: billableRequest said so.) */
  const claim = sb.from('payment_requests').update(patch).eq('id', r.id);
  const { data: linked } = await (r.ap_invoice_id ? claim.eq('ap_invoice_id', r.ap_invoice_id) : claim.is('ap_invoice_id', null)).select('id').maybeSingle();
  if (!linked) {
    await sb.from('ap_invoices').update({ status: 'CANCELLED', cancelled_at: now(), updated_at: now() }).eq('id', inv.id).eq('status', 'DRAFT');
    return c.json({ error: 'bill_exists', message: `${r.request_no} was just given an AP invoice. Open it again.` }, 409);
  }
  await copyPapers(c, sb, companyId, { requestIds: [r.id] }, toBill(inv.id));
  return null;
}

/** POST /accounting/payment-requests/:id/ap-invoice — the request's AP invoice made at once, from its own lines (each on
 *  the account given for it, else its own, else `debitAccountCode`). The screens open the New AP invoice form filled in
 *  from the request instead (POST /ap-invoices with paymentRequestId), where finance chooses the accounts. */
export const makeRequestApInvoiceHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create') && !hasHouzsPerm(c, 'scm.payment_voucher.write')) {
    return c.json({ error: "You don't have permission to raise an AP invoice." }, 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await bodyOf(c)) ?? {};
  const got = await billableRequest(c, sb, co.companyId, String(c.req.param('id')));
  if (!got.ok) return got.res;
  const r = got.r;
  if (!r.supplier_id) return c.json({ error: 'payee_to_check', message: 'Link the payee to a supplier on the list first: an AP invoice is a supplier\'s bill.' }, 409);
  const deposit = r.type === 'DEPOSIT';
  const { data: lineRows } = await sb.from('payment_request_lines').select('*').eq('request_id', r.id);
  const lines = ((lineRows ?? []) as ReqLine[]).sort((x, y) => x.sort - y.sort);
  if (lines.length === 0) return c.json({ error: 'lines_required', message: 'This request has no lines.' }, 409);
  const chosen = b.accounts && typeof b.accounts === 'object' ? (b.accounts as Record<string, unknown>) : {};
  const fallback = b.debitAccountCode ? String(b.debitAccountCode).trim() : '';
  const accountOf = (l: ReqLine) => String(chosen[l.id] ?? '').trim() || l.account_code || fallback;
  if (lines.some(l => !accountOf(l))) return c.json({ error: 'account_missing', message: `${r.request_no}: choose the account for each line.` }, 422);

  const { createApInvoiceCore } = await import('../scm/routes/ap-invoices');
  const made = await createApInvoiceCore(c, {
    supplierId: r.supplier_id,
    invoiceDate: todayMyt(),
    dueDate: r.wanted_on,
    /* A deposit is paid on a quotation: its bill is the quotation until the formal invoice comes (SOP 3.8). */
    provisional: deposit ? b.provisional !== false : b.provisional === true,
    notes: `Payment request ${r.request_no}${deposit ? ' (deposit)' : ''}${r.note ? ` — ${r.note}` : ''}`,
    lines: lines.map(l => ({
      description: l.description ?? r.request_no, debitAccountCode: accountOf(l), amountSen: Number(l.amount_sen),
      department: l.department, subDepartmentId: l.sub_department_id ?? undefined, projectId: l.project_id, unitId: l.unit_id, sourceRequestLineId: l.id,
    })),
  }, { paymentRequestId: r.id });
  const json = (await made.json()) as { invoice?: { id: string; invoice_number: string; supplier_id?: string } } & Record<string, unknown>;
  if (made.status !== 201 || !json.invoice) return c.json(json, made.status as 400);
  const refused = await linkBillToRequest(c, sb, co.companyId, r, json.invoice);
  if (refused) return refused;
  return c.json({ apInvoiceId: json.invoice.id, invoiceNumber: json.invoice.invoice_number }, 201);
};

/** POST /requests/:id/balance — the requester asks finance for the rest of a deposit's bill, with nothing filled in again
 *  (chew, 15 Nov 2026: "直接冲那些只付 deposit 的 request 要求付尾款"): a PAYMENT request for what the bill still owes,
 *  its lines spread from the bill's (project, unit, department kept), linked to the deposit request and to the bill. The
 *  formal invoice may come with it or later. One open balance request per deposit. */
export const balanceRequestHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const staff: Staff = c.get('staff');
  if (staff.field) return c.json({ error: 'forbidden', message: 'The balance is asked for by the office.' }, 403);
  const sb = c.get('supabase');
  const b = (await bodyOf(c)) ?? {};
  const { data: q } = await sb.from('payment_requests').select('id, request_no, type, status, supplier_id, payee_name, purchase_order_id, ap_invoice_id, requester_user_id')
    .eq('company_id', co.companyId).eq('id', c.req.param('id')).eq('requester_user_id', staff.userId).maybeSingle();
  const dep = q as { id: string; request_no: string; type: string; status: string; supplier_id: string | null; payee_name: string; purchase_order_id: string | null; ap_invoice_id: string | null } | null;
  if (!dep) return c.json({ error: 'not_found' }, 404);
  if (dep.type !== 'DEPOSIT' || !(dep.status === 'PAID' || dep.status === 'PART_PAID')) {
    return c.json({ error: 'not_paid_deposit', message: 'The balance is asked for on a deposit that has been paid.' }, 409);
  }
  const bill = await liveBillOf(sb, dep.id);
  if (!bill) return c.json({ error: 'no_bill', message: 'Finance has not booked the quotation for this deposit yet. Ask finance to make its AP invoice first.' }, 409);
  const { data: kids } = await sb.from('payment_requests').select('id, request_no, status').eq('parent_request_id', dep.id);
  const open = ((kids ?? []) as Array<{ request_no: string; status: string }>).find(k => k.status === 'SUBMITTED' || k.status === 'PART_PAID');
  if (open) return c.json({ error: 'balance_open', message: `The balance is already asked for on ${open.request_no}.` }, 409);
  const { data: billRow } = await sb.from('ap_invoices').select('id, total_sen, paid_sen, provisional, due_date').eq('id', bill.id).maybeSingle();
  const inv = billRow as { id: string; total_sen: number; paid_sen: number | null; provisional: boolean; due_date: string | null } | null;
  if (!inv) return c.json({ error: 'no_bill' }, 409);
  /* A deposit paid by its own voucher (Make voucher, before the bill) is an advance until finance knocks it off against
     the bill: it is not asked for again. What the bill has had paid is taken to include the deposit once it covers it. */
  const { data: depPvs } = await sb.from('payment_vouchers').select('id').eq('company_id', co.companyId).eq('payment_request_id', dep.id).eq('status', 'POSTED');
  const depPvIds = ((depPvs ?? []) as Array<{ id: string }>).map(p => p.id);
  const { data: depLines } = depPvIds.length ? await sb.from('payment_voucher_lines').select('amount_sen').in('pv_id', depPvIds) : { data: [] };
  const depositPaid = ((depLines ?? []) as Array<{ amount_sen: number }>).reduce((n, l) => n + Number(l.amount_sen), 0);
  const billPaid = Number(inv.paid_sen ?? 0);
  const covered = Math.max(billPaid, depositPaid);
  const owed = Number(inv.total_sen) - covered;
  if (owed <= 0) return c.json({ error: 'nothing_owed', message: `AP invoice ${bill.invoiceNumber} is already paid in full.` }, 409);
  const { data: bl } = await sb.from('ap_invoice_lines').select(BILL_LINE).eq('invoice_id', inv.id).order('line_no');
  const spread = spreadSen(((bl ?? []) as BillLine[]).sort((x, y) => x.line_no - y.line_no).map(l => ({ ...l, amountSen: Number(l.amount_sen) })), owed);
  if (spread.length === 0) return c.json({ error: 'lines_required', message: 'The AP invoice has no lines.' }, 409);

  const bucket = c.env?.SLIPS;
  let stored: Awaited<ReturnType<typeof storeFiles>> = [];
  const id = crypto.randomUUID();
  if (Array.isArray(b.files) && b.files.length > 0) {
    if (!bucket) return c.json({ error: 'not_configured', message: 'File storage is not set up yet.' }, 501);
    const decoded = decodeFiles(b.files, 'the formal invoice');
    if (!decoded.ok) return c.json({ error: decoded.error, message: decoded.message }, decoded.status);
    try { stored = await storeFiles(bucket, `payment-requests/${co.companyId}/${id}`, decoded.files); } catch {
      return c.json({ error: 'upload_failed', message: 'The files could not be saved. Try again.' }, 502);
    }
  }
  const fail = async (reason: string) => {
    if (bucket) await removeFiles(bucket, stored.map(s => s.r2_key));
    await sb.from('payment_requests').delete().eq('id', id).eq('status', 'SUBMITTED');
    return c.json({ error: 'save_failed', reason }, 500);
  };
  const wanted = DATE.test(String(b.wantedOn ?? '')) ? String(b.wantedOn) : inv.due_date;
  const today = todayMyt();
  const { data: row, error } = await insertWithDocNoRetry<{ id: string; request_no: string }>(
    () => mintMonthlyDocNo(sb, 'payment_requests', 'request_no', `PRQ-${docMonthTag(today)}`),
    no => sb.from('payment_requests').insert({
      id, company_id: co.companyId, request_no: no, type: 'PAYMENT', requester_user_id: staff.userId, supplier_id: dep.supplier_id, payee_name: dep.payee_name,
      payee_to_check: !dep.supplier_id, purchase_order_id: dep.purchase_order_id, wanted_on: wanted, owes_formal_invoice: inv.provisional === true && stored.length === 0,
      note: (b.note ? String(b.note).slice(0, 500) : null) ?? `Balance of ${dep.request_no}`, amount_sen: owed, status: 'SUBMITTED',
      /* The deposit, knocked off later, is not this request's: it counts from what the bill has covered. */
      ap_invoice_id: inv.id, ap_paid_before_sen: covered, parent_request_id: dep.id,
    }).select('id, request_no').single(),
  );
  if (error || !row) {
    if (bucket) await removeFiles(bucket, stored.map(s => s.r2_key));
    return c.json({ error: 'save_failed', reason: error?.message ?? 'insert returned nothing' }, 500);
  }
  const ins = await sb.from('payment_request_lines').insert(spread.map((l, i) => ({
    id: crypto.randomUUID(), request_id: id, department: l.department ?? 'supply', sub_department_id: l.sub_department_id ?? null, unit_id: l.unit_id ?? null,
    maintenance_issue_id: null, project_id: l.project_id ?? null, account_code: l.debit_account_code, amount_sen: l.amountSen, description: l.description ?? null, sort: i,
  })));
  if (ins.error) return fail(ins.error.message);
  if (stored.length) {
    const fr = await sb.from('payment_request_files').insert(stored.map(s => ({ ...s, request_id: id })));
    if (fr.error) return fail(fr.error.message);
  }
  return c.json({ id, requestNo: row.request_no, amountSen: owed, apInvoiceNumber: bill.invoiceNumber }, 201);
};
