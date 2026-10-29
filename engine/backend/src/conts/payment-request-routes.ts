// Conts only (not part of Houzs's code): payment requests to finance (SOP 3.2, 3.5; design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.6). Office staff ask finance to pay a
// supplier, optionally against a PO, or to pay a deposit. A person's own spending is never a request: it is a receipt.
// Staff (mounted on the claims router, so limited to the caller):
//   POST /requests                 { type, supplierId?, payeeName?, purchaseOrderId?, wantedOn?, owesFormalInvoice?, note?, amountSen, lines, files }
//   GET  /requests                 my requests
//   POST /requests/:id/withdraw    while no voucher exists
// Finance (under /accounting, behind the Ledger guard):
//   GET  /accounting/payment-requests?status=&type=
//   POST /accounting/payment-requests/:id/voucher    { bankAccountCode, debitAccountCode? }  (Ledger full)
//   POST /accounting/payment-requests/:id/reject     { reason }    (Ledger edit; while no voucher exists)
//   POST /accounting/payment-requests/:id/close      { reason }    (Ledger full; part paid)
//   PATCH /accounting/payment-requests/:id/supplier  { supplierId } (Ledger edit; while open)
//   GET  /accounting/payment-requests/:id/files/:fileId
// A request has at most one draft voucher at a time (a unique index); each voucher pays what is still owed, line by
// line, and keeps each line's project and unit. A status change claims the row first, and creating a voucher checks
// afterwards that the request was still open, so a withdraw, reject or close racing a voucher cannot leave money going
// out on a closed request.
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { docMonthTag, insertWithDocNoRetry, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { todayMyt } from '../scm/lib/my-time';
import { apControlOf, resolveRoles } from '../acc/rules';
import { buildLines } from './claims-lines';
import { decodeFiles, fileResponse, removeFiles, storeFiles } from './claims-files';
import { overLimitBody, projectLimit } from './project-limit';
import { allRows, inChunks, staffNames } from './petty-cash-store';
import { claimsDeps, EDIT_KEY, FULL_KEY } from './petty-cash-routes';
import { linesStillOwed } from './payment-requests';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN = new Set(['SUBMITTED', 'PART_PAID']);
const who = (c: Ctx): string => String(c.get('houzsUser')?.name ?? c.get('houzsUser')?.email ?? 'unknown');
const forbid = (c: Ctx) => c.json({ error: 'forbidden', message: "You don't have permission to do this." }, 403);
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const now = () => new Date().toISOString();
const isUniqueClash = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === '23505' || /duplicate key/i.test(String(e.message ?? '')));
const REQ_COLS = 'id, request_no, type, requester_user_id, supplier_id, payee_name, payee_to_check, purchase_order_id, wanted_on, owes_formal_invoice, note, amount_sen, status, reason, decided_by, decided_at, created_at';

type ReqRow = {
  id: string; request_no: string; type: string; requester_user_id: string; supplier_id: string | null; payee_name: string; payee_to_check: boolean;
  purchase_order_id: string | null; wanted_on: string | null; owes_formal_invoice: boolean; note: string | null; amount_sen: number; status: string;
  reason: string | null; decided_by: string | null; decided_at: string | null; created_at: string;
};
type ReqLine = { id: string; request_id: string; department: string; unit_id: string | null; maintenance_issue_id: string | null; project_id: number | null; account_code: string | null; amount_sen: number; description: string | null; sort: number };

/** Requests with their lines, files, vouchers and names, as the screens show them. Every list is read in full. */
async function views(sb: any, companyId: number, rows: ReqRow[]) {
  const ids = rows.map(r => r.id);
  if (ids.length === 0) return [];
  const [lines, files, pvs, names] = await Promise.all([
    inChunks<ReqLine>(ids, (part, f, t) => sb.from('payment_request_lines').select('*').in('request_id', part).order('id').range(f, t)),
    inChunks<{ id: string; request_id: string; file_name: string; mime: string }>(ids, (part, f, t) => sb.from('payment_request_files').select('id, request_id, file_name, mime').in('request_id', part).order('id').range(f, t)),
    inChunks<{ id: string; pv_number: string; status: string; payment_request_id: string }>(ids, (part, f, t) => sb.from('payment_vouchers').select('id, pv_number, status, payment_request_id').eq('company_id', companyId).in('payment_request_id', part).order('id').range(f, t)),
    staffNames(sb),
  ]);
  return rows.map(r => ({
    id: r.id, requestNo: r.request_no, type: r.type, requesterUserId: r.requester_user_id, requesterName: names.get(r.requester_user_id) ?? '',
    supplierId: r.supplier_id, payeeName: r.payee_name, payeeToCheck: r.payee_to_check, purchaseOrderId: r.purchase_order_id,
    wantedOn: r.wanted_on, owesFormalInvoice: r.owes_formal_invoice, note: r.note, amountSen: Number(r.amount_sen), status: r.status,
    reason: r.reason, decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at,
    lines: lines.filter(l => l.request_id === r.id).sort((a, b) => a.sort - b.sort).map(l => ({
      department: l.department, unitId: l.unit_id, maintenanceIssueId: l.maintenance_issue_id, projectId: l.project_id, accountCode: l.account_code,
      amountSen: Number(l.amount_sen), description: l.description })),
    files: files.filter(f => f.request_id === r.id).map(f => ({ id: f.id, fileName: f.file_name, mime: f.mime })),
    vouchers: pvs.filter(p => p.payment_request_id === r.id).map(p => ({ id: p.id, pvNumber: p.pv_number, status: p.status })),
  }));
}

async function vouchersOf(sb: any, companyId: number, requestId: string): Promise<Array<{ id: string; status: string }>> {
  const { data, error } = await sb.from('payment_vouchers').select('id, status').eq('company_id', companyId).eq('payment_request_id', requestId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; status: string }>;
}
const live = (pvs: Array<{ status: string }>) => pvs.filter(p => p.status !== 'CANCELLED');

/** Change a request's status only if it is still `from`: true when exactly this call changed it. */
async function claimRequest(sb: any, id: string, from: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from('payment_requests').update({ ...patch, updated_at: now() }).eq('id', id).eq('status', from).select('id').maybeSingle();
  return !error && data != null;
}

/** A draft made a moment ago that lost a race is cancelled at once (never submitted, so nothing else moved). */
async function dropDraft(sb: any, pvId: string): Promise<void> {
  await sb.from('payment_vouchers').update({ status: 'CANCELLED', updated_at: now() }).eq('id', pvId).eq('status', 'DRAFT');
}

/** Would these lines take any project past its limit? Everyday-expense lines are left out, as on vouchers. */
async function overLimit(sb: any, companyId: number, lines: Array<{ project_id: number | null; amount_sen: number; account_code: string | null }>) {
  const codes = [...new Set(lines.map(l => l.account_code).filter((a): a is string => !!a))];
  const { data: accts } = codes.length ? await sb.from('accounts').select('account_code, everyday_expense').eq('company_id', companyId).in('account_code', codes) : { data: [] };
  const everyday = new Set(((accts ?? []) as Array<{ account_code: string; everyday_expense: boolean | null }>).filter(a => a.everyday_expense === true).map(a => a.account_code));
  const byProject = new Map<number, number>();
  for (const l of lines) if (l.project_id != null && !(l.account_code && everyday.has(l.account_code))) byProject.set(l.project_id, (byProject.get(l.project_id) ?? 0) + l.amount_sen);
  const over: Array<{ projectId: number; projectName: string; leftSen: number; overSen: number }> = [];
  for (const [projectId, sen] of byProject) {
    const lim = await projectLimit(sb, companyId, projectId);
    if (!lim.ok) return { error: lim.error };
    if (sen > lim.leftSen) over.push({ projectId, projectName: lim.projectName, leftSen: lim.leftSen, overSen: sen - lim.leftSen });
  }
  return { over };
}

export const submitRequestHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const staff: Staff = c.get('staff');
  if (staff.field) return c.json({ error: 'forbidden', message: 'Hand your receipts in; your supervisor asks finance to pay suppliers.' }, 403);
  const sb = c.get('supabase');
  const bucket = c.env?.SLIPS;
  if (!bucket) return c.json({ error: 'not_configured', message: 'File storage is not set up yet.' }, 501);
  const b = await bodyOf(c);
  if (!b) return c.json({ error: 'invalid_json' }, 400);
  const type = String(b.type ?? '');
  if (type !== 'PAYMENT' && type !== 'DEPOSIT') return c.json({ error: 'validation', message: 'Choose a payment or a deposit.' }, 422);
  let supplierId = b.supplierId ? String(b.supplierId) : null;
  const purchaseOrderId = b.purchaseOrderId ? String(b.purchaseOrderId) : null;
  let poProject: number | null = null;
  if (purchaseOrderId) {
    const { data: po } = await sb.from('purchase_orders').select('id, supplier_id, project_id').eq('company_id', co.companyId).eq('id', purchaseOrderId).maybeSingle();
    if (!po) return c.json({ error: 'validation', message: 'That purchase order was not found.' }, 422);
    supplierId = String(po.supplier_id);
    poProject = po.project_id == null ? null : Number(po.project_id);
  }
  let payeeName = String(b.payeeName ?? '').trim();
  if (supplierId) {
    const { data: s } = await sb.from('suppliers').select('id, name').eq('company_id', co.companyId).eq('id', supplierId).maybeSingle();
    if (!s) return c.json({ error: 'validation', message: 'That supplier was not found.' }, 422);
    payeeName = String(s.name);
  }
  if (type === 'DEPOSIT' && !supplierId) return c.json({ error: 'validation', message: 'A deposit is paid to a supplier on the list.' }, 422);
  if (!payeeName) return c.json({ error: 'validation', message: 'Choose who is paid.' }, 422);
  const amountSen = Number(b.amountSen);
  if (!(Number.isInteger(amountSen) && amountSen > 0)) return c.json({ error: 'validation', message: 'Enter the amount.' }, 422);
  const wantedOn = DATE.test(String(b.wantedOn ?? '')) ? String(b.wantedOn) : null;
  const decoded = decodeFiles(b.files, 'the invoice, receipt or quotation');
  if (!decoded.ok) return c.json({ error: decoded.error, message: decoded.message }, decoded.status);
  /* A PO's project fills lines that name none. */
  const rawLines = Array.isArray(b.lines) && poProject != null
    ? (b.lines as Array<Record<string, unknown>>).map(l => (l.projectId == null || l.projectId === '' ? { ...l, projectId: poProject } : l))
    : b.lines;
  const built = await buildLines(sb, staff, rawLines, amountSen, co.companyId);
  if (!built.ok) return c.json({ error: 'validation', message: built.message }, 422);
  /* SOP 3.2: a request over a project's limit cannot be submitted. */
  const lim = await overLimit(sb, co.companyId, built.lines);
  if ('error' in lim) return c.json({ error: 'limit_unavailable', message: 'The project limit could not be read. Try again.' }, 503);
  if (lim.over.length) return c.json(overLimitBody(lim.over), 409);

  const id = crypto.randomUUID();
  let stored: Awaited<ReturnType<typeof storeFiles>> = [];
  try { stored = await storeFiles(bucket, `payment-requests/${co.companyId}/${id}`, decoded.files); } catch {
    return c.json({ error: 'upload_failed', message: 'The files could not be saved. Try again.' }, 502);
  }
  const fail = async (reason: string) => {
    await sb.from('payment_requests').delete().eq('id', id);
    await removeFiles(bucket, stored.map(s => s.r2_key));
    return c.json({ error: 'save_failed', reason }, 500);
  };
  const today = todayMyt();
  const { data: row, error } = await insertWithDocNoRetry<{ id: string; request_no: string }>(
    () => mintMonthlyDocNo(sb, 'payment_requests', 'request_no', `PRQ-${docMonthTag(today)}`),
    no => sb.from('payment_requests').insert({
      id, company_id: co.companyId, request_no: no, type, requester_user_id: staff.userId, supplier_id: supplierId, payee_name: payeeName.slice(0, 200),
      payee_to_check: !supplierId, purchase_order_id: purchaseOrderId, wanted_on: wantedOn, owes_formal_invoice: type === 'DEPOSIT' || b.owesFormalInvoice === true,
      note: b.note ? String(b.note).slice(0, 500) : null, amount_sen: amountSen, status: 'SUBMITTED',
    }).select('id, request_no').single(),
  );
  if (error || !row) return fail(error?.message ?? 'insert returned nothing');
  const ins = await sb.from('payment_request_lines').insert(built.lines.map(l => ({ ...l, request_id: id })));
  if (ins.error) return fail(ins.error.message);
  const fr = await sb.from('payment_request_files').insert(stored.map(s => ({ ...s, request_id: id })));
  if (fr.error) return fail(fr.error.message);
  return c.json({ id, requestNo: row.request_no }, 201);
};

export const myRequestsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const userId = (c.get('staff') as Staff).userId;
  const rows = (await allRows<ReqRow>((f, t) => sb.from('payment_requests').select(REQ_COLS).eq('company_id', co.companyId).eq('requester_user_id', userId).order('id').range(f, t)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return c.json({ requests: await views(sb, co.companyId, rows) });
};

export const withdrawRequestHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data: r } = await sb.from('payment_requests').select('id, status').eq('company_id', co.companyId).eq('id', c.req.param('id')).eq('requester_user_id', (c.get('staff') as Staff).userId).maybeSingle();
  if (!r) return c.json({ error: 'not_found' }, 404);
  const refused = () => c.json({ error: 'cannot_withdraw', message: 'Finance has started paying this request.' }, 409);
  if (!(await claimRequest(sb, r.id, 'SUBMITTED', { status: 'WITHDRAWN' }))) return refused();
  /* Claimed; a voucher made in the meantime wins, and the request goes back. */
  if (live(await vouchersOf(sb, co.companyId, r.id)).length > 0) { await claimRequest(sb, r.id, 'WITHDRAWN', { status: 'SUBMITTED' }); return refused(); }
  return c.json({ ok: true });
};

/** Adds the staff request routes to the claims router. */
export function myRequestRoutes(r: { get: (p: string, h: (c: Ctx) => Promise<Response>) => unknown; post: (p: string, h: (c: Ctx) => Promise<Response>) => unknown }) {
  r.post('/requests', submitRequestHandler);
  r.get('/requests', myRequestsHandler);
  r.post('/requests/:id/withdraw', withdrawRequestHandler);
}

async function loadRequest(c: Ctx, companyId: number): Promise<ReqRow | null> {
  const { data } = await c.get('supabase').from('payment_requests').select(REQ_COLS).eq('company_id', companyId).eq('id', c.req.param('id')).maybeSingle();
  return (data as ReqRow | null) ?? null;
}

export const listRequestsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const status = String(c.req.query('status') ?? '');
  const type = String(c.req.query('type') ?? '');
  const all = await allRows<ReqRow>((f, t) => {
    let q = sb.from('payment_requests').select(REQ_COLS).eq('company_id', co.companyId);
    if (status) q = q.eq('status', status);
    if (type) q = q.eq('type', type);
    return q.order('id').range(f, t);
  });
  /* Waiting first, oldest first; the rest newest first. */
  const waiting = (s: string) => (OPEN.has(s) ? 0 : 1);
  const rows = all.sort((a, b) => waiting(a.status) - waiting(b.status) || (waiting(a.status) === 0 ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  return c.json({ requests: await views(sb, co.companyId, rows) });
};

export const requestVoucherHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = (await bodyOf(c)) ?? {};
  const bank = String(b.bankAccountCode ?? '').trim();
  if (!bank) return c.json({ error: 'validation', message: 'Choose the bank this is paid from.' }, 422);
  const fallback = b.debitAccountCode ? String(b.debitAccountCode).trim() : null;
  const sb = c.get('supabase');
  const r = await loadRequest(c, co.companyId);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (!OPEN.has(r.status)) return c.json({ error: 'not_open', message: 'This request is not waiting for payment.' }, 409);
  if (r.payee_to_check && !r.supplier_id) return c.json({ error: 'payee_to_check', message: 'Link the payee to a supplier on the list before paying.' }, 409);
  const pvs = await vouchersOf(sb, co.companyId, r.id);
  if (pvs.some(p => p.status === 'DRAFT')) return c.json({ error: 'voucher_open', message: 'A voucher for this request is already being prepared. Finish or cancel it first.' }, 409);
  const { data: lineRows } = await sb.from('payment_request_lines').select('*').eq('request_id', r.id);
  const requestLines = ((lineRows ?? []) as ReqLine[]).sort((a, x) => a.sort - x.sort);
  const { data: paidRows } = pvs.length ? await sb.from('payment_voucher_lines').select('amount_sen, pv_id').in('pv_id', pvs.filter(p => p.status === 'POSTED').map(p => p.id)) : { data: [] };
  const paid = ((paidRows ?? []) as Array<{ amount_sen: number }>).reduce((n, l) => n + Number(l.amount_sen), 0);
  const owed = linesStillOwed(requestLines.map(l => ({ ...l, amount_sen: Number(l.amount_sen) })), paid);
  if (owed.length === 0) return c.json({ error: 'nothing_owed', message: 'This request is already paid in full.' }, 409);

  /* With a supplier, the voucher pays the supplier: every line debits the supplier's own creditors control, so a deposit
     stands as an advance on the supplier and the later invoice is set off against it. Without one it pays the cost. */
  let debitOf: (l: ReqLine) => string | null;
  let supplier: { id: string; name: string } | null = null;
  if (r.supplier_id) {
    const { data: s } = await sb.from('suppliers').select('id, code, name, control_account').eq('company_id', co.companyId).eq('id', r.supplier_id).maybeSingle();
    if (!s) return c.json({ error: 'validation', message: 'The supplier on this request was not found.' }, 409);
    const control = apControlOf(await resolveRoles(sb, co.companyId), { code: s.code, control_account: s.control_account });
    debitOf = () => control;
    supplier = { id: s.id, name: s.name };
  } else {
    if (owed.some(l => !l.account_code) && !fallback) return c.json({ error: 'account_missing', message: 'Choose the account for the lines that have none.' }, 422);
    debitOf = l => l.account_code ?? fallback;
  }
  const made = await claimsDeps.createVoucher(c, {
    payeeName: supplier?.name ?? r.payee_name, supplierId: supplier?.id, creditAccountCode: bank,
    purpose: supplier ? 'SUPPLIER_PAYMENT' : 'OTHER',
    lines: owed.map(l => ({ debitAccountCode: debitOf(l), amountSen: l.amount_sen, description: l.description ?? r.request_no, department: l.department })),
    notes: `Payment request ${r.request_no}${r.type === 'DEPOSIT' ? ' (deposit)' : ''}${r.note ? ` — ${r.note}` : ''}`,
  });
  if (!made.ok) return c.json(made.body, made.status as 400);
  const link = await sb.from('payment_vouchers').update({ payment_request_id: r.id }).eq('id', made.id);
  if (link.error) {
    await dropDraft(sb, made.id);
    if (isUniqueClash(link.error)) return c.json({ error: 'voucher_open', message: 'A voucher for this request was just made.' }, 409);
    return c.json({ error: 'update_failed', reason: link.error.message }, 500);
  }
  /* Each voucher line keeps its request line's project and unit. */
  for (const [i, l] of owed.entries()) {
    await sb.from('payment_voucher_lines').update({ project_id: l.project_id, unit_id: l.unit_id }).eq('pv_id', made.id).eq('line_no', i + 1);
  }
  /* Withdrawn, rejected or closed while the voucher was being made: the request wins and the draft goes. */
  const { data: still } = await sb.from('payment_requests').select('status').eq('id', r.id).maybeSingle();
  if (!still || !OPEN.has(String(still.status))) {
    await dropDraft(sb, made.id);
    return c.json({ error: 'not_open', message: 'This request was closed while the voucher was being made.' }, 409);
  }
  return c.json({ pvId: made.id, pvNumber: made.pvNumber }, 201);
};

export const rejectRequestHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, EDIT_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const reason = String((await bodyOf(c))?.reason ?? '').trim();
  if (!reason) return c.json({ error: 'reason_required', message: 'Say why the request is rejected.' }, 422);
  const sb = c.get('supabase');
  const r = await loadRequest(c, co.companyId);
  if (!r) return c.json({ error: 'not_found' }, 404);
  const refused = () => c.json({ error: 'not_open', message: 'Only a request with no voucher can be rejected.' }, 409);
  if (!(await claimRequest(sb, r.id, 'SUBMITTED', { status: 'REJECTED', reason: reason.slice(0, 500), decided_by: who(c), decided_at: now() }))) return refused();
  if (live(await vouchersOf(sb, co.companyId, r.id)).length > 0) {
    await claimRequest(sb, r.id, 'REJECTED', { status: 'SUBMITTED', reason: null, decided_by: null, decided_at: null });
    return refused();
  }
  return c.json({ ok: true });
};

export const closeRequestHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const reason = String((await bodyOf(c))?.reason ?? '').trim();
  if (!reason) return c.json({ error: 'reason_required', message: 'Say why the request is closed short.' }, 422);
  const sb = c.get('supabase');
  const r = await loadRequest(c, co.companyId);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (!(await claimRequest(sb, r.id, 'PART_PAID', { status: 'CLOSED', reason: reason.slice(0, 500), decided_by: who(c), decided_at: now() }))) {
    return c.json({ error: 'not_part_paid', message: 'Only a part-paid request can be closed.' }, 409);
  }
  /* What was being prepared for it goes too: a closed request pays nothing more. */
  for (const p of await vouchersOf(sb, co.companyId, r.id)) if (p.status === 'DRAFT') await dropDraft(sb, p.id);
  return c.json({ ok: true });
};

export const linkSupplierHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, EDIT_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const supplierId = String((await bodyOf(c))?.supplierId ?? '').trim();
  const sb = c.get('supabase');
  const r = await loadRequest(c, co.companyId);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (!OPEN.has(r.status)) return c.json({ error: 'not_open', message: 'This request is no longer waiting for payment.' }, 409);
  const { data: s } = supplierId ? await sb.from('suppliers').select('id, name').eq('company_id', co.companyId).eq('id', supplierId).maybeSingle() : { data: null };
  if (!s) return c.json({ error: 'validation', message: 'Choose a supplier on the list.' }, 422);
  const { error } = await sb.from('payment_requests').update({ supplier_id: s.id, payee_name: s.name, payee_to_check: false, updated_at: now() }).eq('id', r.id);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
};

export const requestFileHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const r = await loadRequest(c, co.companyId);
  if (!r) return c.json({ error: 'not_found' }, 404);
  const { data: f } = await c.get('supabase').from('payment_request_files').select('r2_key, file_name, mime').eq('request_id', r.id).eq('id', c.req.param('fileId')).maybeSingle();
  const obj = f ? await c.env?.SLIPS?.get(f.r2_key) : null;
  if (!f || !obj) return c.json({ error: 'not_found' }, 404);
  return fileResponse(obj, f.file_name, f.mime);
};
