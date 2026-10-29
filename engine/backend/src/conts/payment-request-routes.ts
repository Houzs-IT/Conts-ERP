// Conts only (not part of Houzs's code): payment requests to finance (SOP 3.2, 3.5; design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.6). Office staff ask finance to pay a
// supplier, optionally against a PO, or to pay a deposit. A person's own spending is never a request: it is a receipt.
// Staff (mounted on the claims router, so limited to the caller):
//   POST /requests                 { type, supplierId?, payeeName?, purchaseOrderId?, wantedOn?, owesFormalInvoice?, note?, lines, files }
//   GET  /requests                 my requests
//   POST /requests/:id/withdraw    while no voucher exists
// Finance (under /accounting, behind the Ledger guard):
//   GET  /accounting/payment-requests?status=&type=
//   POST /accounting/payment-requests/:id/voucher    { bankAccountCode, debitAccountCode? }  (Ledger full)
//   POST /accounting/payment-requests/:id/reject     { reason }    (Ledger edit; while no voucher exists)
//   POST /accounting/payment-requests/:id/close      { reason }    (Ledger full; part paid)
//   PATCH /accounting/payment-requests/:id/supplier  { supplierId } (Ledger edit)
//   GET  /accounting/payment-requests/:id/files/:fileId
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { DOC_FILE_MIMES, MAX_DOC_FILE_BYTES, decodeBase64 } from '../scm/lib/doc-files';
import { docMonthTag, insertWithDocNoRetry, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { todayMyt } from '../scm/lib/my-time';
import { buildLines } from './claims-lines';
import { overLimitBody, projectLimit } from './project-limit';
import { staffNames } from './petty-cash-store';
import { claimsDeps, EDIT_KEY, FULL_KEY } from './petty-cash-routes';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const who = (c: Ctx): string => String(c.get('houzsUser')?.name ?? c.get('houzsUser')?.email ?? 'unknown');
const forbid = (c: Ctx) => c.json({ error: 'forbidden', message: "You don't have permission to do this." }, 403);
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const REQ_COLS = 'id, request_no, type, requester_user_id, supplier_id, payee_name, payee_to_check, purchase_order_id, wanted_on, owes_formal_invoice, note, amount_sen, status, reason, decided_by, decided_at, created_at';

type ReqRow = {
  id: string; request_no: string; type: string; requester_user_id: string; supplier_id: string | null; payee_name: string; payee_to_check: boolean;
  purchase_order_id: string | null; wanted_on: string | null; owes_formal_invoice: boolean; note: string | null; amount_sen: number; status: string;
  reason: string | null; decided_by: string | null; decided_at: string | null; created_at: string;
};

/** Requests with their lines, files, vouchers and names, as the screens show them. */
async function views(sb: any, companyId: number, rows: ReqRow[]) {
  const ids = rows.map(r => r.id);
  if (ids.length === 0) return [];
  const [{ data: lines }, { data: files }, { data: pvs }, names] = await Promise.all([
    sb.from('payment_request_lines').select('*').in('request_id', ids),
    sb.from('payment_request_files').select('id, request_id, file_name, mime').in('request_id', ids),
    sb.from('payment_vouchers').select('id, pv_number, status, payment_request_id').eq('company_id', companyId).in('payment_request_id', ids),
    staffNames(sb),
  ]);
  return rows.map(r => ({
    id: r.id, requestNo: r.request_no, type: r.type, requesterUserId: r.requester_user_id, requesterName: names.get(r.requester_user_id) ?? '',
    supplierId: r.supplier_id, payeeName: r.payee_name, payeeToCheck: r.payee_to_check, purchaseOrderId: r.purchase_order_id,
    wantedOn: r.wanted_on, owesFormalInvoice: r.owes_formal_invoice, note: r.note, amountSen: Number(r.amount_sen), status: r.status,
    reason: r.reason, decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at,
    lines: ((lines ?? []) as Array<Record<string, any>>).filter(l => l.request_id === r.id).sort((a, b) => a.sort - b.sort).map(l => ({
      department: l.department, unitId: l.unit_id, maintenanceIssueId: l.maintenance_issue_id, projectId: l.project_id, accountCode: l.account_code,
      amountSen: Number(l.amount_sen), description: l.description })),
    files: ((files ?? []) as Array<Record<string, any>>).filter(f => f.request_id === r.id).map(f => ({ id: f.id, fileName: f.file_name, mime: f.mime })),
    vouchers: ((pvs ?? []) as Array<Record<string, any>>).filter(p => p.payment_request_id === r.id).map(p => ({ id: p.id, pvNumber: p.pv_number, status: p.status })),
  }));
}

async function liveVouchers(sb: any, companyId: number, requestId: string): Promise<number> {
  const { data } = await sb.from('payment_vouchers').select('id, status').eq('company_id', companyId).eq('payment_request_id', requestId);
  return ((data ?? []) as Array<{ status: string }>).filter(p => p.status !== 'CANCELLED').length;
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
  if (purchaseOrderId) {
    const { data: po } = await sb.from('purchase_orders').select('id, supplier_id').eq('company_id', co.companyId).eq('id', purchaseOrderId).maybeSingle();
    if (!po) return c.json({ error: 'validation', message: 'That purchase order was not found.' }, 422);
    supplierId = String(po.supplier_id);
  }
  let payeeName = String(b.payeeName ?? '').trim();
  if (supplierId) {
    const { data: s } = await sb.from('suppliers').select('id, name').eq('id', supplierId).maybeSingle();
    if (!s) return c.json({ error: 'validation', message: 'That supplier was not found.' }, 422);
    payeeName = String(s.name);
  }
  if (type === 'DEPOSIT' && !supplierId) return c.json({ error: 'validation', message: 'A deposit is paid to a supplier on the list.' }, 422);
  if (!payeeName) return c.json({ error: 'validation', message: 'Choose who is paid.' }, 422);
  const amountSen = Number(b.amountSen);
  if (!(Number.isInteger(amountSen) && amountSen > 0)) return c.json({ error: 'validation', message: 'Enter the amount.' }, 422);
  const wantedOn = DATE.test(String(b.wantedOn ?? '')) ? String(b.wantedOn) : null;
  const files = Array.isArray(b.files) ? (b.files as Array<Record<string, unknown>>) : [];
  if (files.length === 0 || files.length > 8) return c.json({ error: 'validation', message: 'Add the invoice, receipt or quotation.' }, 422);
  const decoded: Array<{ name: string; mime: string; bytes: Uint8Array }> = [];
  for (const f of files) {
    const mime = String(f.mime ?? '');
    const bytes = decodeBase64(String(f.dataBase64 ?? ''));
    if (!DOC_FILE_MIMES.has(mime) || !bytes || bytes.byteLength === 0) return c.json({ error: 'bad_type', message: 'Photos (JPEG, PNG, WebP) or a PDF only.' }, 400);
    if (bytes.byteLength > MAX_DOC_FILE_BYTES) return c.json({ error: 'bad_size', message: 'Each file must be under 20 MB.' }, 400);
    decoded.push({ name: String(f.name ?? 'document').slice(0, 200), mime, bytes });
  }
  const built = await buildLines(sb, staff, b.lines, amountSen);
  if (!built.ok) return c.json({ error: 'validation', message: built.message }, 422);
  /* SOP 3.2: a request over a project's limit cannot be submitted. */
  const lim = await overLimit(sb, co.companyId, built.lines);
  if ('error' in lim) return c.json({ error: 'limit_unavailable', message: 'The project limit could not be read. Try again.' }, 503);
  if (lim.over.length) return c.json(overLimitBody(lim.over), 409);

  const today = todayMyt();
  const { data: row, error } = await insertWithDocNoRetry<{ id: string; request_no: string }>(
    () => mintMonthlyDocNo(sb, 'payment_requests', 'request_no', `PRQ-${docMonthTag(today)}`),
    no => sb.from('payment_requests').insert({
      company_id: co.companyId, request_no: no, type, requester_user_id: staff.userId, supplier_id: supplierId, payee_name: payeeName.slice(0, 200),
      payee_to_check: !supplierId, purchase_order_id: purchaseOrderId, wanted_on: wantedOn, owes_formal_invoice: type === 'DEPOSIT' || b.owesFormalInvoice === true,
      note: b.note ? String(b.note).slice(0, 500) : null, amount_sen: amountSen, status: 'SUBMITTED',
    }).select('id, request_no').single(),
  );
  if (error || !row) return c.json({ error: 'save_failed', reason: error?.message ?? 'insert returned nothing' }, 500);
  const ins = await sb.from('payment_request_lines').insert(built.lines.map(l => ({ ...l, request_id: row.id })));
  if (ins.error) return c.json({ error: 'save_failed', reason: ins.error.message }, 500);
  for (const f of decoded) {
    const key = `payment-requests/${co.companyId}/${row.id}/${crypto.randomUUID()}.${EXT[f.mime]}`;
    await bucket.put(key, f.bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: f.mime } });
    const fr = await sb.from('payment_request_files').insert({ request_id: row.id, r2_key: key, file_name: f.name, mime: f.mime, byte_size: f.bytes.byteLength });
    if (fr.error) return c.json({ error: 'save_failed', reason: fr.error.message }, 500);
  }
  return c.json({ id: row.id, requestNo: row.request_no }, 201);
};

export const myRequestsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data, error } = await sb.from('payment_requests').select(REQ_COLS).eq('company_id', co.companyId).eq('requester_user_id', (c.get('staff') as Staff).userId);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = ((data ?? []) as ReqRow[]).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return c.json({ requests: await views(sb, co.companyId, rows) });
};

export const withdrawRequestHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data: r } = await sb.from('payment_requests').select('id, status').eq('company_id', co.companyId).eq('id', c.req.param('id')).eq('requester_user_id', (c.get('staff') as Staff).userId).maybeSingle();
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.status !== 'SUBMITTED' || (await liveVouchers(sb, co.companyId, r.id)) > 0) return c.json({ error: 'cannot_withdraw', message: 'Finance has started paying this request.' }, 409);
  const { error } = await sb.from('payment_requests').update({ status: 'WITHDRAWN', updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'SUBMITTED');
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
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
  let q = sb.from('payment_requests').select(REQ_COLS).eq('company_id', co.companyId);
  const status = String(c.req.query('status') ?? '');
  if (status) q = q.eq('status', status);
  const type = String(c.req.query('type') ?? '');
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  /* Waiting first, oldest first; the rest newest first. */
  const waiting = (s: string) => (s === 'SUBMITTED' || s === 'PART_PAID' ? 0 : 1);
  const rows = ((data ?? []) as ReqRow[]).sort((a, b) => waiting(a.status) - waiting(b.status) || (waiting(a.status) === 0 ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
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
  if (r.status !== 'SUBMITTED' && r.status !== 'PART_PAID') return c.json({ error: 'not_open', message: 'This request is not waiting for payment.' }, 409);
  if (r.payee_to_check && !r.supplier_id) return c.json({ error: 'payee_to_check', message: 'Link the payee to a supplier on the list before paying.' }, 409);
  const { data: lines } = await sb.from('payment_request_lines').select('*').eq('request_id', r.id);
  const ls = ((lines ?? []) as Array<Record<string, any>>).sort((a, b2) => a.sort - b2.sort);
  if (ls.some(l => !l.account_code) && !fallback) return c.json({ error: 'account_missing', message: 'Choose the account for the lines that have none.' }, 422);
  const projects = [...new Set(ls.map(l => l.project_id).filter(p => p != null))];
  const made = await claimsDeps.createVoucher(c, {
    payeeName: r.payee_name, supplierId: r.supplier_id ?? undefined, creditAccountCode: bank,
    /* A deposit to a supplier is booked as an advance on the supplier, so the invoice can be set off against it later. */
    purpose: r.type === 'DEPOSIT' || r.supplier_id ? 'SUPPLIER_PAYMENT' : 'OTHER',
    projectId: projects.length === 1 ? projects[0] : undefined,
    lines: ls.map(l => ({ debitAccountCode: l.account_code ?? fallback, amountSen: Number(l.amount_sen), description: l.description ?? r.request_no, department: l.department })),
    notes: `Payment request ${r.request_no}${r.type === 'DEPOSIT' ? ' (deposit)' : ''}${r.note ? ` — ${r.note}` : ''}`,
  });
  if (!made.ok) return c.json(made.body, made.status as 400);
  const link = await sb.from('payment_vouchers').update({ payment_request_id: r.id }).eq('id', made.id);
  if (link.error) return c.json({ error: 'update_failed', reason: link.error.message }, 500);
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
  if (r.status !== 'SUBMITTED' || (await liveVouchers(sb, co.companyId, r.id)) > 0) return c.json({ error: 'not_open', message: 'Only a request with no voucher can be rejected.' }, 409);
  const { error } = await sb.from('payment_requests').update({ status: 'REJECTED', reason: reason.slice(0, 500), decided_by: who(c), decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'SUBMITTED');
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
};

export const closeRequestHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, FULL_KEY)) return forbid(c);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const reason = String((await bodyOf(c))?.reason ?? '').trim();
  if (!reason) return c.json({ error: 'reason_required', message: 'Say why the request is closed short.' }, 422);
  const r = await loadRequest(c, co.companyId);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.status !== 'PART_PAID') return c.json({ error: 'not_part_paid', message: 'Only a part-paid request can be closed.' }, 409);
  const { error } = await c.get('supabase').from('payment_requests').update({ status: 'CLOSED', reason: reason.slice(0, 500), decided_by: who(c), decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'PART_PAID');
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
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
  const { data: s } = supplierId ? await sb.from('suppliers').select('id, name').eq('id', supplierId).maybeSingle() : { data: null };
  if (!s) return c.json({ error: 'validation', message: 'Choose a supplier on the list.' }, 422);
  const { error } = await sb.from('payment_requests').update({ supplier_id: s.id, payee_name: s.name, payee_to_check: false, updated_at: new Date().toISOString() }).eq('id', r.id);
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
  return new Response(obj.body, { headers: { 'content-type': f.mime, 'content-disposition': `inline; filename="${String(f.file_name).replace(/"/g, '')}"`, 'cache-control': 'private, max-age=300' } });
};
