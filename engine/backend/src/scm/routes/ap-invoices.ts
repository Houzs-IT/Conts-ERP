// ----------------------------------------------------------------------------
// AP Invoices — the non-stock supplier bill (AutoCount's A/P Invoice).
//
// The owner's design (2026-09-06, AutoCount in hand): 可以不可以像 autocount
// 这样 purchase invoice 一边,然后再多一个 AP invoice,这样我就可以把 other
// creditor 的 invoice 放过去,也不会影响 operation 那边的 purchase invoice —
// and, confirmed line by line: 我想要两个都看到, 现有的 purchase invoice remain.
//
//   · the Finance list shows BOTH kinds — the operational purchase invoices as
//     a read-only MIRROR (raised on the Procurement side, untouched here) and
//     the AP invoices raised HERE — one table, a `kind` column;
//   · an AP invoice is Draft → Post → (paid down by AP Payments) → Paid, or
//     Cancelled; posting books Dr each line's OWN account / Cr the supplier's
//     AP control — 400 or 405 by the supplier's code, the same split the PI
//     and the PV use (source API; cancel = the engine's contra);
//   · it is paid by the SAME AP Payment that pays purchase invoices: an
//     allocation names a PI or an AP invoice, and the paid_sen clamp has an
//     identical twin (lib/ap-invoice-settlement.ts).
//
// MYR only in this first cut — an other creditor's rent or service bill —
// foreign bills stay on the purchase-invoice side, which carries the rate
// machinery. Permission keys are the PV family's on purpose: the same people
// raise, post and cancel money documents.
// Numbering: {co}API-YYMM-NNN — a NEW series (flagged to the owner; his prefix).
//
// Evidence and memory (owner 2026-09-06: 做,附件也一起做,bundle 也带上): the
// bill's files live beside it (/:id/files — routes/ap-invoice-files.ts, the
// PV's own factory) and ride the AP Payment's print bundle; a save teaches
// vendor memory (mig 0341) the supplier → first-line account, so the OCR
// (POST /payment-vouchers/extract, shared) pre-fills the next same-vendor
// bill here as it does on a voucher.
// ----------------------------------------------------------------------------

import { checkProjectsFit, resolveLinesSub } from '../../conts/sub-departments';
import { Hono } from 'hono';
import { deferScmAfterCommit, runScmPgCommand } from '../lib/pg-supabase-transaction';
import { ledgerEditSide } from '../../acc/ledger-settings';
import { hasHouzsPerm } from '../lib/houzs-perms';
import { activeCompanyId, companyDocPrefix, requireActiveCompanyId, scopeToCompany } from '../lib/companyScope';
import { docMonthTag, mintMonthlyDocNo } from '../lib/doc-no';
import { dateOrNull } from '../lib/date-coerce';
import { todayMyt } from '../lib/my-time';
import { postJournal, reverseJournal } from '../../acc/engine';
import { apInvoiceLines, DEFAULT_DEPARTMENT, isDepartment, resolveRoles, type Department } from '../../acc/rules';
import { requireLeafAccount } from './accounting-chart';
import { learnVendorMemory } from './payment-vouchers';
import {
  uploadApInvoiceFileHandler, listApInvoiceFilesHandler, streamApInvoiceFileHandler, deleteApInvoiceFileHandler,
} from './ap-invoice-files';
import { supabaseAuth } from '../middleware/auth';
import { fmtSen } from '../shared/format';
import { duplicateBillRefusal, findDuplicateSupplierBill } from '../lib/duplicate-supplier-bill';
import { listDuplicateSupplierBillsHandler } from './ap-duplicate-bills';
import { afterBillSavedBestEffort, billableRequest, linkBillToRequest, releaseRequestsOfBillBestEffort } from '../../conts/request-ap-invoice';

const isUniqueClash = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === '23505' || /duplicate key/i.test(String(e.message ?? '')));

type Row = Record<string, any>;

const NO_PERM = (what: string) => ({ error: `You don't have permission to ${what}.` });

const HEADER = 'id, company_id, invoice_number, supplier_id, supplier_invoice_ref, invoice_date, due_date, currency, exchange_rate, total_sen, paid_sen, status, notes, created_at, created_by, posted_at, posted_by, cancelled_at, cancelled_by, payment_request_id, provisional';
const LINE = 'id, line_no, description, debit_account_code, amount_sen, department, project_id, sub_department_id, unit_id, source_request_line_id, item_group';

/* Conts: each line's department (finance phase 1, spec 3.5); none is Supply chain. The unit, and the payment request line
   it came from (chew, 15 Nov 2026: a request becomes an AP invoice; spec 2026-11-15-request-to-ap-invoice-design.md). */
type CleanLine = { description: string | null; code: string; amountSen: number; department: Department; projectId: number | null; subDepartmentId: string | null; unitId: string | null; sourceRequestLineId: string | null; itemGroup: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lines a bill takes: 50, or as many as a utility payment request holds when the bill is made from a request (one line
    per unit's bill, up to 500). */
const MAX_LINES = 50;
const MAX_REQUEST_LINES = 500;

/** 1–50 lines (500 on a bill made from a payment request), each with a leaf account and a positive integer sen. */
function buildLines(raw: unknown, maxLines = MAX_LINES): { lines: CleanLine[]; total: number } | { error: string; message: string } {
  const arr = Array.isArray(raw) ? raw : [];
  if (arr.length === 0 || arr.length > maxLines) return { error: 'lines_required', message: `An AP invoice takes 1 to ${maxLines} lines.` };
  const lines: CleanLine[] = [];
  for (const [i, l] of arr.entries()) {
    const code = String(l?.debitAccountCode ?? '').trim();
    const amount = Number(l?.amountSen);
    if (!code) return { error: 'bad_line', message: `Line ${i + 1} has no account.` };
    if (!Number.isInteger(amount) || amount <= 0) {
      return { error: 'bad_line', message: `Line ${i + 1}: amountSen must be a positive integer (got ${String(l?.amountSen)}).` };
    }
    if (l?.department != null && !isDepartment(l.department)) {
      return { error: 'bad_line', message: `Line ${i + 1}: the department must be Rental, Renovation or Shared.` };
    }
    /* The project a cost belongs to (a renovation subcontractor's bill): blank = none. */
    const project = l?.projectId == null || l.projectId === '' ? null : Number(l.projectId);
    if (project != null && !Number.isSafeInteger(project)) return { error: 'bad_line', message: `Line ${i + 1}: choose the project from the list.` };
    const unitId = l?.unitId == null || String(l.unitId).trim() === '' ? null : String(l.unitId).trim().slice(0, 80);
    const source = l?.sourceRequestLineId && UUID.test(String(l.sourceRequestLineId)) ? String(l.sourceRequestLineId).toLowerCase() : null;
    /* The stock group the line buys (chew, 18 Nov 2026), blank for none: a group code, as the item groups page names it. */
    const group = String(l?.itemGroup ?? '').trim().toUpperCase();
    if (group && !/^[A-Z0-9_]{1,40}$/.test(group)) return { error: 'bad_line', message: `Line ${i + 1}: choose the stock group from the list.` };
    lines.push({
      description: l?.description ? String(l.description).trim() : null, code, amountSen: amount,
      department: isDepartment(l?.department) ? l.department : DEFAULT_DEPARTMENT, projectId: project, subDepartmentId: null,
      unitId, sourceRequestLineId: source, itemGroup: group || null,
    });
  }
  return { lines, total: lines.reduce((s, l) => s + l.amountSen, 0) };
}

/** Each line's sub-department (SOP 1.1; chew 4 Nov 2026): a named one sets the line's department. `saved`: each
    line's own (by position), kept even after it was retired. Null = all good; else the refusal. */
async function subRefusal(c: any, companyId: number, lines: CleanLine[], raw: unknown, saved: ReadonlyArray<string | null> = []): Promise<Response | null> {
  const r = await resolveLinesSub(c.get('supabase'), companyId, Array.isArray(raw) ? raw : [], saved);
  if (!r.ok) return c.json({ error: r.error, message: r.message }, r.status);
  r.lines.forEach((s, i) => { if (s && lines[i]) { lines[i]!.department = s.department; lines[i]!.subDepartmentId = s.subDepartmentId; } });
  /* And each named project fits its line's sub-department (SOP 1.1): side and brand. */
  const fit = await checkProjectsFit(c.get('supabase'), companyId, r.list, lines);
  if (fit) return c.json({ error: 'project_mismatch', message: fit }, 400);
  return null;
}

/** Every project the lines name must be one of the company's (public.projects): a cost must never sit on a project
    that does not exist. Null = all good; else the refusal. */
async function projectRefusal(c: any, companyId: number, lines: CleanLine[]): Promise<Response | null> {
  const ids = [...new Set(lines.map((l) => l.projectId).filter((p): p is number => p != null))];
  if (ids.length === 0) return null;
  const { data, error } = await c.get('supabase').schema('public').from('projects').select('id').eq('company_id', companyId).in('id', ids);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const found = new Set(((data ?? []) as Array<{ id: number }>).map((p) => Number(p.id)));
  return ids.every((p) => found.has(p)) ? null : c.json({ error: 'bad_line', message: 'A line names a project this company does not have. Pick the project again.' }, 400);
}

async function loadInvoice(c: any, id: string): Promise<{ inv: Row } | { resp: Response }> {
  const sb = c.get('supabase');
  const { data, error } = await scopeToCompany(sb.from('ap_invoices').select(HEADER).eq('id', id), c).maybeSingle();
  if (error) return { resp: c.json({ error: 'load_failed', reason: error.message }, 500) };
  if (!data) return { resp: c.json({ error: 'not_found', message: 'That AP invoice is not in the company you are working in.' }, 404) };
  return { inv: data as Row };
}

async function loadSupplier(c: any, supplierId: string): Promise<{ supplier: { id: string; code: string | null; name: string | null } } | { resp: Response }> {
  const sb = c.get('supabase');
  const { data, error } = await scopeToCompany(sb.from('suppliers').select('id, code, name, control_account').eq('id', supplierId), c).maybeSingle();
  if (error) return { resp: c.json({ error: 'load_failed', reason: error.message }, 500) };
  if (!data) return { resp: c.json({ error: 'supplier_unknown', message: 'That supplier is not in the company you are working in.' }, 400) };
  return { supplier: data as { id: string; code: string | null; name: string | null } };
}

/* ── GET / — both kinds, one list ─────────────────────────────────────────── */
export const listApInvoicesHandler = async (c: any): Promise<Response> => {
  /* Reads ride the finance area guard (GET → 'view'), as the receipts and
     other-debtors lists do; the PV key family gates the WRITES below. */
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const kind = String(c.req.query('kind') ?? 'ALL').toUpperCase();

  const rows: Row[] = [];
  if (kind === 'ALL' || kind === 'API') {
    const { data, error } = await scopeToCompany(
      sb.from('ap_invoices').select(`${HEADER}, supplier:suppliers(id, code, name)`), c,
    ).order('invoice_date', { ascending: false }).limit(500);
    if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
    for (const r of (data ?? []) as Row[]) rows.push(shape('API', r));
  }
  if (kind === 'ALL' || kind === 'PI') {
    /* The operational invoices, read-only here: the Procurement page raises
       and edits them; this list only SHOWS them beside the AP invoices so
       the Finance side sees a supplier's whole debt. */
    const { data, error } = await scopeToCompany(
      sb.from('purchase_invoices')
        .select('id, invoice_number, supplier_invoice_ref, supplier_id, invoice_date, due_date, currency, total_sen, paid_sen, status, notes, supplier:suppliers(id, code, name)')
        .in('status', ['POSTED', 'PARTIALLY_PAID', 'PAID', 'ON_HOLD']), c,
    ).order('invoice_date', { ascending: false }).limit(500);
    if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
    for (const r of (data ?? []) as Row[]) rows.push(shape('PI', r));
  }
  rows.sort((a, b) => String(b.invoiceDate ?? '').localeCompare(String(a.invoiceDate ?? '')) || String(b.invoiceNumber).localeCompare(String(a.invoiceNumber)));
  return c.json({ rows });
};

function shape(kind: 'API' | 'PI', r: Row): Row {
  const sup = Array.isArray(r.supplier) ? r.supplier[0] : r.supplier;
  const total = Number(r.total_sen ?? 0);
  const paid = Number(r.paid_sen ?? 0);
  return {
    kind,
    id: r.id,
    invoiceNumber: r.invoice_number,
    supplierId: r.supplier_id ?? null,
    supplierCode: sup?.code ?? null,
    supplierName: sup?.name ?? null,
    supplierInvoiceRef: r.supplier_invoice_ref ?? null,
    /* The overall description (owner 2026-09-06: 我想要 overall description,
       到时可以显示在这界面) — the notes column, on both kinds. */
    description: r.notes ? String(r.notes) : null,
    invoiceDate: r.invoice_date ?? null,
    dueDate: r.due_date ?? null,
    currency: r.currency ?? 'MYR',
    totalSen: total,
    paidSen: paid,
    outstandingSen: Math.max(0, total - paid),
    status: String(r.status ?? ''),
    /* A quotation booked before its formal invoice (chew, 15 Nov 2026; SOP 3.8). */
    provisional: r.provisional === true,
  };
}

/* ── GET /:id — an AP invoice with its lines ─────────────────────────────── */
export const apInvoiceDetailHandler = async (c: any): Promise<Response> => {
  const found = await loadInvoice(c, c.req.param('id'));
  if ('resp' in found) return found.resp;
  const sb = c.get('supabase');
  const [lines, sup] = await Promise.all([
    scopeToCompany(sb.from('ap_invoice_lines').select(LINE).eq('invoice_id', found.inv.id), c).order('line_no'),
    scopeToCompany(sb.from('suppliers').select('id, code, name, control_account').eq('id', found.inv.supplier_id), c).maybeSingle(),
  ]);
  if (lines.error) return c.json({ error: 'load_failed', reason: lines.error.message }, 500);
  if (sup.error) return c.json({ error: 'load_failed', reason: sup.error.message }, 500);
  /* The payment requests paid through it: the one it was made from, and a deposit's balance (chew, 15 Nov 2026). */
  const { data: reqs } = await sb.from('payment_requests').select('id, request_no, type, status, amount_sen, parent_request_id')
    .eq('company_id', found.inv.company_id).eq('ap_invoice_id', found.inv.id);
  const requests = ((reqs ?? []) as Row[]).map((r) => ({ id: r.id, requestNo: r.request_no, type: r.type, status: r.status, amountSen: Number(r.amount_sen), balance: !!r.parent_request_id }));
  return c.json({ invoice: found.inv, lines: lines.data ?? [], supplier: sup.data ?? null, requests });
};

/* ── POST / — raise a DRAFT ──────────────────────────────────────────────── */
export const createApInvoiceHandler = async (c: any): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create') && !hasHouzsPerm(c, 'scm.payment_voucher.write')) {
    return c.json(NO_PERM('raise an AP invoice'), 403);
  }
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  /* Conts (chew, 16 Nov 2026): the New AP invoice form opened from a payment request names it; the bill is checked to be
     one the request may have, made, and the request takes it (conts/request-ap-invoice.ts). */
  const requestId = typeof body?.paymentRequestId === 'string' ? body.paymentRequestId.trim() : '';
  if (!requestId) return createApInvoiceCore(c, body);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const got = await billableRequest(c, sb, co.companyId, requestId);
  if (!got.ok) return got.res;
  const made = await createApInvoiceCore(c, body, { paymentRequestId: requestId });
  if (made.status !== 201) return made;
  const json = (await made.clone().json()) as { invoice: { id: string; supplier_id: string } };
  const refused = await linkBillToRequest(c, sb, co.companyId, got.r, json.invoice);
  if (refused) return refused;
  /* What finance changed on the form (amounts, lines) the request follows, as on any save of the bill. */
  await afterBillSavedBestEffort(sb, json.invoice.id);
  return made;
};

/** Raise a DRAFT bill from `body` (the POST / fields). `from` is set only by the engine itself: a bill made from a
    payment request (conts/request-ap-invoice.ts) names it, and takes as many lines as the request has. */
export async function createApInvoiceCore(c: any, body: any, from: { paymentRequestId?: string } = {}): Promise<Response> {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create') && !hasHouzsPerm(c, 'scm.payment_voucher.write')) {
    return c.json(NO_PERM('raise an AP invoice'), 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_json' }, 400);

  const supplierId = String(body.supplierId ?? '').trim();
  if (!supplierId) return c.json({ error: 'supplier_required', message: 'Pick the supplier this bill is from.' }, 400);
  const currency = String(body.currency ?? 'MYR').trim().toUpperCase() || 'MYR';
  if (currency !== 'MYR') {
    return c.json({ error: 'currency_unsupported', message: 'AP invoices are MYR in this first cut — a foreign bill goes through a purchase invoice, which carries the rate.' }, 400);
  }
  const built = buildLines(body.lines, from.paymentRequestId ? MAX_REQUEST_LINES : MAX_LINES);
  if ('error' in built) return c.json({ error: built.error, message: built.message }, 400);
  const badSub = await subRefusal(c, co.companyId, built.lines, body.lines);
  if (badSub) return badSub;
  const badProject = await projectRefusal(c, co.companyId, built.lines);
  if (badProject) return badProject;
  const invoiceDate = dateOrNull(body.invoiceDate) ?? todayMyt();
  const dueDate = dateOrNull(body.dueDate);

  const sup = await loadSupplier(c, supplierId);
  if ('resp' in sup) return sup.resp;
  /* Each debit line takes only ordinary LEAVES — the same door the PV's
     lines walk: headers refuse (父户不记账), controls refuse (由模块过账). */
  for (const code of [...new Set(built.lines.map((l) => l.code))]) {
    const leafErr = await requireLeafAccount(c, co.companyId, code);
    if (leafErr) return leafErr;
  }

  const sb = c.get('supabase');
  /* One supplier bill is owed once (ported from Houzs): a live bill of this supplier with the same bill number refuses,
     naming it. A quotation and a formal invoice never pair (lib/duplicate-supplier-bill.ts). */
  {
    const dup = await findDuplicateSupplierBill(sb, 'ap_invoices', { companyId: co.companyId, supplierId: String(sup.supplier.id), ref: body.supplierInvoiceRef, excludeId: null, quotation: body.provisional === true });
    if (!dup.ok) return c.json({ error: 'lookup_failed', reason: dup.reason }, 500);
    if (dup.duplicate) return c.json(duplicateBillRefusal(body.supplierInvoiceRef, dup.duplicate), 409);
  }
  const invoiceNumber = await mintMonthlyDocNo(sb, 'ap_invoices', 'invoice_number', `${companyDocPrefix(c)}API-${docMonthTag(invoiceDate)}`);
  const { data: inv, error: insErr } = await sb.from('ap_invoices').insert({
    company_id: co.companyId,
    invoice_number: invoiceNumber,
    supplier_id: sup.supplier.id,
    supplier_invoice_ref: body.supplierInvoiceRef ? String(body.supplierInvoiceRef).trim() : null,
    invoice_date: invoiceDate,
    due_date: dueDate,
    currency: 'MYR',
    exchange_rate: 1,
    total_sen: built.total,
    paid_sen: 0,
    status: 'DRAFT',
    notes: body.notes ? String(body.notes).trim() : null,
    created_by: String(c.get('user')?.id ?? ''),
    provisional: body.provisional === true,
    ...(from.paymentRequestId ? { payment_request_id: from.paymentRequestId } : {}),
  }).select(HEADER).single();
  if (insErr && from.paymentRequestId && isUniqueClash(insErr)) {
    return c.json({ error: 'bill_exists', message: 'This request already has an AP invoice.' }, 409);
  }
  if (insErr || !inv) return c.json({ error: 'save_failed', reason: insErr?.message ?? 'insert returned nothing' }, 500);

  const { error: lineErr } = await sb.from('ap_invoice_lines').insert(built.lines.map((l, i) => ({
    company_id: co.companyId,
    invoice_id: (inv as Row).id,
    line_no: i + 1,
    description: l.description,
    debit_account_code: l.code,
    amount_sen: l.amountSen,
    department: l.department,
    project_id: l.projectId,
    ...(l.subDepartmentId ? { sub_department_id: l.subDepartmentId } : {}),
    unit_id: l.unitId,
    source_request_line_id: l.sourceRequestLineId,
    ...(l.itemGroup ? { item_group: l.itemGroup } : {}),
  })));
  if (lineErr) {
    await sb.from('ap_invoices').delete().eq('company_id', co.companyId).eq('id', (inv as Row).id);
    return c.json({ error: 'save_failed', reason: lineErr.message }, 500);
  }
  /* The habit this bill teaches: the supplier's name → the first line's
     account, so the OCR's next reading of the same vendor's bill pre-fills
     it. A voucher paying a supplier has nothing to teach (its line is the AP
     control); the BILL is where the expense account is chosen — hence the
     source flag, which lifts memory's supplier-payment skip for this call. */
  await learnVendorMemory(sb, c, {
    payeeName: sup.supplier.name, purpose: 'SUPPLIER_PAYMENT', source: 'AP_INVOICE',
    lines: built.lines.map((l, i) => ({ line_no: i + 1, debit_account_code: l.code })),
  });
  return c.json({ ok: true, invoice: inv }, 201);
}

/* ── PATCH /:id — every field may change (owner 2026-09-06: edit 这个不能全部
   都设成可以改吗). A DRAFT simply changes. A POSTED bill RE-POSTS: the
   engine's contra voids the old entry (dated as the old bill was) and a fresh
   entry books the edited bill (dated as it now is) — the ledger keeps the
   trail instead of a silent overwrite, AutoCount's edit-and-repost with the
   history left in. Three guards: money already paid caps the new total, a
   bill with money on it keeps its supplier, a cancelled bill is left alone. */
export const updateApInvoiceHandler = async (c: any): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create') && !hasHouzsPerm(c, 'scm.payment_voucher.write')) {
    return c.json(NO_PERM('edit an AP invoice'), 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const found = await loadInvoice(c, c.req.param('id'));
  if ('resp' in found) return found.resp;
  const inv = found.inv;
  if (inv.status === 'CANCELLED') {
    return c.json({ error: 'cancelled', message: `${inv.invoice_number} is cancelled — raise it again instead.` }, 409);
  }
  const posted = inv.status !== 'DRAFT';
  const paid = Number(inv.paid_sen ?? 0);
  /* Snapshot what the contra needs BEFORE the update: a client that hands out
     live row references (the test fake does) would otherwise show the edited
     date here, and the contra must be dated as the OLD bill was. */
  const oldDate = String(inv.invoice_date);
  const oldSupplierId = String(inv.supplier_id);
  const sb = c.get('supabase');
  const patch: Row = { updated_at: new Date().toISOString() };
  if (body.supplierId !== undefined) {
    const sup = await loadSupplier(c, String(body.supplierId ?? '').trim());
    if ('resp' in sup) return sup.resp;
    if (paid > 0 && sup.supplier.id !== oldSupplierId) {
      return c.json({ error: 'supplier_locked', message: `${inv.invoice_number} has ${fmtSen(paid)} paid against it — the money sits on its supplier; cancel the payment before moving the bill.` }, 409);
    }
    patch.supplier_id = sup.supplier.id;
  }
  if (body.supplierInvoiceRef !== undefined) patch.supplier_invoice_ref = body.supplierInvoiceRef ? String(body.supplierInvoiceRef).trim() : null;
  if (body.invoiceDate !== undefined) patch.invoice_date = dateOrNull(body.invoiceDate) ?? inv.invoice_date;
  if (body.dueDate !== undefined) patch.due_date = dateOrNull(body.dueDate);
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
  /* Quotation → formal invoice: unticked when the formal invoice replaces it (chew, 15 Nov 2026). */
  if (body.provisional !== undefined) patch.provisional = body.provisional === true;
  /* The bill as it will read: its supplier, number and kind (a quotation turned into its formal invoice is checked as
     a formal invoice, never against itself). Checked before the first write. */
  if (patch.supplier_id !== undefined || patch.supplier_invoice_ref !== undefined || patch.provisional !== undefined) {
    const ref = patch.supplier_invoice_ref !== undefined ? patch.supplier_invoice_ref : inv.supplier_invoice_ref;
    const quotation = patch.provisional !== undefined ? patch.provisional === true : inv.provisional === true;
    const dup = await findDuplicateSupplierBill(sb, 'ap_invoices', { companyId: co.companyId, supplierId: String(patch.supplier_id ?? inv.supplier_id), ref, excludeId: String(inv.id), quotation });
    if (!dup.ok) return c.json({ error: 'lookup_failed', reason: dup.reason }, 500);
    if (dup.duplicate) return c.json(duplicateBillRefusal(ref, dup.duplicate), 409);
  }
  /* A posted bill is not moved across the ledger start; before it, the books
     stay as they were (Conts). Checked before the first write. */
  let side: 'after' | 'before' = 'after';
  if (posted) {
    const s = await ledgerEditSide(sb, co.companyId, oldDate.slice(0, 10), String(patch.invoice_date ?? inv.invoice_date).slice(0, 10));
    if (!s.ok) return c.json({ error: 'load_failed', reason: s.error }, 500);
    if (s.side === 'across') return c.json({ error: s.message }, 409);
    side = s.side;
  }
  let rebuilt: { lines: CleanLine[]; total: number } | null = null;
  if (body.lines !== undefined) {
    const built = buildLines(body.lines, inv.payment_request_id ? MAX_REQUEST_LINES : MAX_LINES);
    if ('error' in built) return c.json({ error: built.error, message: built.message }, 400);
    const { data: hadSubs } = await sb.from('ap_invoice_lines').select('line_no, sub_department_id').eq('company_id', co.companyId).eq('invoice_id', inv.id).order('line_no');
    const badSub = await subRefusal(c, co.companyId, built.lines, body.lines, ((hadSubs ?? []) as Array<{ sub_department_id?: string | null }>).map((h) => h.sub_department_id ?? null));
    if (badSub) return badSub;
    const badProject = await projectRefusal(c, co.companyId, built.lines);
    if (badProject) return badProject;
    if (built.total < paid) {
      return c.json({ error: 'total_below_paid', message: `${inv.invoice_number} already has ${fmtSen(paid)} paid against it — the total cannot fall below that.` }, 409);
    }
    for (const code of [...new Set(built.lines.map((l) => l.code))]) {
      const leafErr = await requireLeafAccount(c, co.companyId, code);
      if (leafErr) return leafErr;
    }
    patch.total_sen = built.total;
    rebuilt = built;
  }
  if (posted) {
    const newTotal = rebuilt ? rebuilt.total : Number(inv.total_sen ?? 0);
    patch.status = newTotal <= paid ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'POSTED';
  }
  /* D4 (#1126): the lines, the header and the ledger re-post commit together or not at all. Before, the old lines
     were deleted and the new ones inserted, then the header, then contra and re-post, each on its own: a failure
     part-way left a bill whose lines, total and journal disagreed, and nothing put it right. */
  return runScmPgCommand(c, async (tx) => {
    if (rebuilt) {
      await tx.from('ap_invoice_lines').delete().eq('company_id', co.companyId).eq('invoice_id', inv.id);
      await tx.from('ap_invoice_lines').insert(rebuilt.lines.map((l, i) => ({
        company_id: co.companyId, invoice_id: inv.id, line_no: i + 1,
        description: l.description, debit_account_code: l.code, amount_sen: l.amountSen, department: l.department, project_id: l.projectId,
        ...(l.subDepartmentId ? { sub_department_id: l.subDepartmentId } : {}),
        unit_id: l.unitId, source_request_line_id: l.sourceRequestLineId,
        ...(l.itemGroup ? { item_group: l.itemGroup } : {}),
      })));
    }
    /* Compare-and-set on what the checks above read: a voucher settling this bill, or a cancel, since then makes the
       edit refuse rather than write a status and total computed from a stale paid figure. */
    const { data, error } = await tx.from('ap_invoices').update(patch)
      .eq('company_id', co.companyId).eq('id', inv.id).eq('paid_sen', paid).neq('status', 'CANCELLED')
      .select(HEADER).maybeSingle();
    if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
    if (!data) return c.json({ error: 'changed', message: `${String(inv.invoice_number)} was paid or cancelled while you were editing it. Reload and try again.` }, 409);
    /* The request it was made from follows the bill; every request paid through it settles again (a new total may make
       it paid). Conts, chew 15 Nov 2026. After the commit, so it reads the saved bill. */
    deferScmAfterCommit(c, () => afterBillSavedBestEffort(sb, inv.id));
    if (!posted) return c.json({ ok: true, invoice: data });
    if (side === 'before') return c.json({ ok: true, invoice: data, reposted: false });

    /* The re-post: contra the entry the old bill wrote, then book the bill as
       it now reads — through the one gate, so numbering and the one-active-
       entry rule hold exactly as on the first post. */
    const after = (data ?? inv) as Row;
    const rev = await reverseJournal(tx, {
      sourceType: 'API',
      sourceDocNo: String(inv.invoice_number),
      companyId: co.companyId,
      narration: (orig) => `Reversal of ${orig.je_no} — AP invoice ${inv.invoice_number} edited`,
      entryDate: oldDate,
    });
    if (!rev.ok) return c.json({ error: 'reverse_failed', status: rev.status, reason: (rev as { reason?: string }).reason ?? rev.status }, 500);
    const sup = await loadSupplier(c, String(after.supplier_id));
    if ('resp' in sup) return sup.resp;
    const { data: lineRows, error: lErr } = await scopeToCompany(tx.from('ap_invoice_lines').select(LINE).eq('invoice_id', inv.id), c).order('line_no');
    if (lErr) return c.json({ error: 'load_failed', reason: lErr.message }, 500);
    const lines = (lineRows ?? []) as Array<{ description: string | null; debit_account_code: string; amount_sen: number; department?: string | null; project_id?: number | null; sub_department_id?: string | null }>;
    const roles = await resolveRoles(tx, co.companyId);
    const je = await postJournal(tx, {
      companyId: co.companyId,
      entryDate: String(after.invoice_date),
      sourceType: 'API',
      sourceDocNo: String(inv.invoice_number),
      narration: `AP invoice ${inv.invoice_number} — ${sup.supplier.name ?? sup.supplier.code ?? 'supplier'}${after.supplier_invoice_ref ? ` (${after.supplier_invoice_ref})` : ''} — edited`,
      lines: apInvoiceLines(roles, { invoice_number: String(inv.invoice_number) }, sup.supplier,
        lines.map((l) => ({ accountCode: l.debit_account_code, myrSen: Number(l.amount_sen), description: l.description, department: isDepartment(l.department) ? l.department : DEFAULT_DEPARTMENT, projectId: l.project_id ?? null, subDepartmentId: l.sub_department_id ?? null }))),
    });
    if (!je.ok) return c.json({ error: 'post_failed', status: je.status, reason: (je as { reason?: string }).reason ?? je.status }, 500);
    return c.json({ ok: true, invoice: after, reposted: true, jeNo: je.jeNo });
  });
};

/* ── POST /:id/post — into the ledger, once ──────────────────────────────── */
export const postApInvoiceHandler = async (c: any): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) return c.json(NO_PERM('post to the general ledger'), 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadInvoice(c, c.req.param('id'));
  if ('resp' in found) return found.resp;
  const inv = found.inv;
  if (inv.status === 'CANCELLED') return c.json({ error: 'cancelled', message: `${inv.invoice_number} is cancelled.` }, 409);
  const sb = c.get('supabase');
  const { data: lineRows, error: lErr } = await scopeToCompany(sb.from('ap_invoice_lines').select(LINE).eq('invoice_id', inv.id), c).order('line_no');
  if (lErr) return c.json({ error: 'load_failed', reason: lErr.message }, 500);
  const lines = (lineRows ?? []) as Array<{ description: string | null; debit_account_code: string; amount_sen: number; department?: string | null; project_id?: number | null; sub_department_id?: string | null }>;
  if (lines.length === 0) return c.json({ error: 'lines_required', message: 'This bill has no lines to post.' }, 400);
  const sup = await loadSupplier(c, String(inv.supplier_id));
  if ('resp' in sup) return sup.resp;

  const roles = await resolveRoles(sb, co.companyId);
  const je = await postJournal(sb, {
    companyId: co.companyId,
    entryDate: String(inv.invoice_date),
    sourceType: 'API',
    sourceDocNo: String(inv.invoice_number),
    narration: `AP invoice ${inv.invoice_number} — ${sup.supplier.name ?? sup.supplier.code ?? 'supplier'}${inv.supplier_invoice_ref ? ` (${inv.supplier_invoice_ref})` : ''}`,
    lines: apInvoiceLines(roles, { invoice_number: String(inv.invoice_number) }, sup.supplier,
      lines.map((l) => ({ accountCode: l.debit_account_code, myrSen: Number(l.amount_sen), description: l.description, department: isDepartment(l.department) ? l.department : DEFAULT_DEPARTMENT, projectId: l.project_id ?? null, subDepartmentId: l.sub_department_id ?? null }))),
  });
  if (!je.ok) return c.json({ error: 'post_failed', status: je.status, reason: (je as { reason?: string }).reason ?? je.status }, 500);

  if (inv.status === 'DRAFT') {
    const { error: upErr } = await sb.from('ap_invoices').update({
      status: 'POSTED', posted_at: new Date().toISOString(), posted_by: String(c.get('houzsUser')?.name ?? c.get('user')?.id ?? ''), updated_at: new Date().toISOString(),
    }).eq('company_id', co.companyId).eq('id', inv.id);
    if (upErr) return c.json({ error: 'save_failed', reason: upErr.message }, 500);
  }
  return c.json({ ok: true, jeNo: je.jeNo, status: je.status });
};

/* ── POST /:id/cancel — a draft dies quietly; a posted bill gets its contra ─ */
export const cancelApInvoiceHandler = async (c: any): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.cancel')) return c.json(NO_PERM('cancel an AP invoice'), 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadInvoice(c, c.req.param('id'));
  if ('resp' in found) return found.resp;
  const inv = found.inv;
  if (inv.status === 'CANCELLED') return c.json({ ok: true, already: true });
  if (Number(inv.paid_sen ?? 0) > 0) {
    return c.json({ error: 'has_payments', message: `${inv.invoice_number} has ${fmtSen(Number(inv.paid_sen))} paid against it — cancel the payment first.` }, 409);
  }
  const sb = c.get('supabase');
  if (inv.status !== 'DRAFT') {
    const rev = await reverseJournal(sb, {
      sourceType: 'API',
      sourceDocNo: String(inv.invoice_number),
      companyId: co.companyId,
      narration: (orig) => `Reversal of ${orig.je_no} — AP invoice ${inv.invoice_number} cancelled`,
      entryDate: todayMyt(),
    });
    if (!rev.ok) return c.json({ error: 'reverse_failed', status: rev.status, reason: (rev as { reason?: string }).reason ?? rev.status }, 500);
  }
  const { error: upErr } = await sb.from('ap_invoices').update({
    status: 'CANCELLED', cancelled_at: new Date().toISOString(), cancelled_by: String(c.get('houzsUser')?.name ?? c.get('user')?.id ?? ''), updated_at: new Date().toISOString(),
  }).eq('company_id', co.companyId).eq('id', inv.id);
  if (upErr) return c.json({ error: 'save_failed', reason: upErr.message }, 500);
  /* The requests paid through it are let go: they are paid by their own vouchers again, or get a new bill. */
  await releaseRequestsOfBillBestEffort(sb, inv.id);
  return c.json({ ok: true });
};

export const apInvoices = new Hono();
/* The SCM bridge is PER ROUTER (scm/index.ts mounts no global one): it stashes
   the real caller as houzsUser — what hasHouzsPerm reads — and hands out the
   service client. Without it every read here answered 403 and every write crashed. See docs/bugs/0648; tests/scmRouterBridge.test.ts pins it. */
apInvoices.use('*', supabaseAuth);
apInvoices.get('/', listApInvoicesHandler);
apInvoices.post('/', createApInvoiceHandler);
/* Before /:id, so the detail matcher never takes it. */
apInvoices.get('/duplicate-bills', listDuplicateSupplierBillsHandler);
/* Files before /:id, as the PV mounts them — the evidence paths never fall
   into the detail matcher. */
apInvoices.post('/:id/files', uploadApInvoiceFileHandler);
apInvoices.get('/:id/files', listApInvoiceFilesHandler);
apInvoices.get('/:id/files/:fileId', streamApInvoiceFileHandler);
apInvoices.delete('/:id/files/:fileId', deleteApInvoiceFileHandler);
apInvoices.get('/:id', apInvoiceDetailHandler);
apInvoices.patch('/:id', updateApInvoiceHandler);
apInvoices.post('/:id/post', postApInvoiceHandler);
apInvoices.post('/:id/cancel', cancelApInvoiceHandler);

/* Referenced so a stale import never hides that the active company is the
   scope on every write above. */
void activeCompanyId;
