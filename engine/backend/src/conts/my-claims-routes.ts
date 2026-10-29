// Conts only (not part of Houzs's code): what a member of staff does with their own receipts and requests (SOP 3.2, 6;
// design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.3-4.7). The same router is mounted
// twice: /api/claims for someone signed in to the engine (staffFromSession), and /api/claims-forward for a call
// Property OS forwards on a person's behalf (staffFromAssertion). Every query is limited to the caller; a keeper's to
// their own float.
//   GET  /me                       who I am here: field or office, where my receipts go, whether I keep a float
//   POST /extract                  { files: [{ name, mime, dataBase64 }] } -> { amountSen, date, vendorName }
//   POST /receipts                 hand in a receipt (paid from my department's float, or by finance)
//   GET  /receipts?month=          my receipts
//   GET  /receipts/:id/files/:fileId   a receipt's file: mine, or on the float I keep
//   GET  /float?month=             the float I keep, with its receipts
//   POST /float/top-up-request     ask finance to top my float up
//   GET  /jobs                     maintenance jobs I may put a receipt on
//   GET  /units                    units to name on a receipt
//   GET  /accounts, /projects       what a cost is, and the project it is on
//   GET  /suppliers?q=, /purchase-orders?q=   who finance pays (office staff)
import { Hono } from 'hono';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { todayMyt } from '../scm/lib/my-time';
import { DOC_FILE_MIMES, MAX_DOC_FILE_BYTES, decodeBase64 } from '../scm/lib/doc-files';
import { docMonthTag, insertWithDocNoRetry, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { extractOneBill } from '../acc/bill-extract';
import { lineDepartment, resolveFloatId } from './petty-cash';
import { RECEIPT_COLS, filesOf, floatBalances, linesOf, monthRange, receiptView, staffNames, type FloatRow, type ReceiptRow } from './petty-cash-store';
import type { Staff } from './staff-identity';
import { buildLines } from './claims-lines';
import { myRequestRoutes } from './payment-request-routes';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_FILES = 8;
const staffOf = (c: Ctx): Staff => c.get('staff');
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };

/** The float that pays my receipts: my override, else my department's active float, else none. */
async function myFloatId(sb: any, companyId: number, staff: Staff): Promise<string | null> {
  const [{ data: ov }, { data: floats }] = await Promise.all([
    sb.from('petty_cash_overrides').select('user_id, float_id').eq('company_id', companyId).eq('user_id', staff.userId),
    sb.from('petty_cash_floats').select('id, department_id').eq('company_id', companyId).eq('active', true),
  ]);
  const overrides = new Map(((ov ?? []) as Array<{ user_id: string; float_id: string }>).map(o => [o.user_id, o.float_id]));
  const live = (floats ?? []) as Array<{ id: string; department_id: string }>;
  const id = resolveFloatId(staff.userId, staff.departmentId, overrides, new Map(live.map(f => [f.department_id, f.id])));
  /* An override pointing at a float that has since closed falls back to the department's. */
  return id && live.some(f => f.id === id) ? id : resolveFloatId(staff.userId, staff.departmentId, new Map(), new Map(live.map(f => [f.department_id, f.id])));
}

async function keptFloat(sb: any, companyId: number, staff: Staff): Promise<FloatRow | null> {
  const { data } = await sb.from('petty_cash_floats').select('*').eq('company_id', companyId).eq('keeper_user_id', staff.userId).eq('active', true).maybeSingle();
  return (data as FloatRow | null) ?? null;
}

export const meHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const s = staffOf(c);
  const sb = c.get('supabase');
  const [floatId, kept] = await Promise.all([myFloatId(sb, co.companyId, s), keptFloat(sb, co.companyId, s)]);
  return c.json({ userId: s.userId, name: s.name, field: s.field, lineDepartment: lineDepartment(s.side), route: floatId ? 'float' : 'finance', keepsFloat: !!kept });
};

export const extractHandler = async (c: Ctx): Promise<Response> => {
  const key = (c.env as { ANTHROPIC_API_KEY?: string } | undefined)?.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: 'anthropic_key_missing', message: 'Reading receipts is not set up yet. Type the amount.' }, 503);
  const files = (await bodyOf(c))?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) return c.json({ error: 'validation', message: 'Add the receipt photos.' }, 422);
  const bill = (files as Array<Record<string, unknown>>).map(f => ({ name: String(f.name ?? 'receipt'), mime: String(f.mime ?? ''), dataBase64: String(f.dataBase64 ?? '') }));
  if (bill.some(f => !DOC_FILE_MIMES.has(f.mime))) return c.json({ error: 'bad_type', message: 'Photos (JPEG, PNG, WebP) or a PDF only.' }, 400);
  const r = await extractOneBill(key, bill);
  if (!r.ok) return c.json({ amountSen: null, date: null, vendorName: null, unreadable: true });
  const x = r.extraction;
  return c.json({ amountSen: x.totalSen ?? null, date: x.invoiceDate && DATE.test(x.invoiceDate) ? x.invoiceDate : null, vendorName: x.vendorName ?? null });
};

export const handInHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const staff = staffOf(c);
  const sb = c.get('supabase');
  const bucket = c.env?.SLIPS;
  if (!bucket) return c.json({ error: 'not_configured', message: 'File storage is not set up yet.' }, 501);
  const b = await bodyOf(c);
  if (!b) return c.json({ error: 'invalid_json' }, 400);
  const amountSen = Number(b.amountSen);
  if (!(Number.isInteger(amountSen) && amountSen > 0)) return c.json({ error: 'validation', message: 'Enter the amount on the receipt.' }, 422);
  const spendDate = DATE.test(String(b.spendDate ?? '')) ? String(b.spendDate) : todayMyt();
  if (spendDate > todayMyt()) return c.json({ error: 'validation', message: 'The receipt date cannot be in the future.' }, 422);
  const files = Array.isArray(b.files) ? (b.files as Array<Record<string, unknown>>) : [];
  if (files.length === 0 || files.length > MAX_FILES) return c.json({ error: 'validation', message: 'Add a photo of the receipt.' }, 422);
  const decoded: Array<{ name: string; mime: string; bytes: Uint8Array }> = [];
  for (const f of files) {
    const mime = String(f.mime ?? '');
    const bytes = decodeBase64(String(f.dataBase64 ?? ''));
    if (!DOC_FILE_MIMES.has(mime) || !bytes || bytes.byteLength === 0) return c.json({ error: 'bad_type', message: 'Photos (JPEG, PNG, WebP) or a PDF only.' }, 400);
    if (bytes.byteLength > MAX_DOC_FILE_BYTES) return c.json({ error: 'bad_size', message: 'Each file must be under 20 MB.' }, 400);
    decoded.push({ name: String(f.name ?? 'receipt').slice(0, 200), mime, bytes });
  }
  const built = await buildLines(sb, staff, b.lines, amountSen);
  if (!built.ok) return c.json({ error: 'validation', message: built.message }, 422);

  /* A proper receipt for one finance rejected replaces it and keeps its float. */
  let replaces: ReceiptRow | null = null;
  if (b.replacesId) {
    const { data } = await sb.from('staff_receipts').select(RECEIPT_COLS).eq('company_id', co.companyId).eq('id', String(b.replacesId)).eq('submitter_user_id', staff.userId).maybeSingle();
    replaces = (data as ReceiptRow | null) ?? null;
    if (!replaces) return c.json({ error: 'not_found' }, 404);
    if (replaces.status !== 'REJECTED') return c.json({ error: 'not_rejected', message: 'Only a rejected receipt can be replaced.' }, 409);
  }
  const floatId = replaces ? replaces.float_id : await myFloatId(sb, co.companyId, staff);
  const source = c.get('claimsSource') === 'forward' ? (staff.field ? 'field_app' : 'property_os') : 'engine';

  const { data: row, error } = await insertWithDocNoRetry<{ id: string; receipt_no: string }>(
    () => mintMonthlyDocNo(sb, 'staff_receipts', 'receipt_no', `CLM-${docMonthTag(spendDate)}`),
    no => sb.from('staff_receipts').insert({
      company_id: co.companyId, receipt_no: no, submitter_user_id: staff.userId, float_id: floatId, spend_date: spendDate,
      amount_sen: amountSen, vendor_name: b.vendorName ? String(b.vendorName).slice(0, 200) : null, note: b.note ? String(b.note).slice(0, 500) : null,
      status: 'HANDED_IN', replaces_id: replaces?.id ?? null, source,
    }).select('id, receipt_no').single(),
  );
  if (error || !row) return c.json({ error: 'save_failed', reason: error?.message ?? 'insert returned nothing' }, 500);
  const ins = await sb.from('staff_receipt_lines').insert(built.lines.map(l => ({ ...l, receipt_id: row.id })));
  if (ins.error) return c.json({ error: 'save_failed', reason: ins.error.message }, 500);
  for (const f of decoded) {
    const key = `claims/${co.companyId}/${row.id}/${crypto.randomUUID()}.${EXT[f.mime]}`;
    await bucket.put(key, f.bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: f.mime } });
    const fr = await sb.from('staff_receipt_files').insert({ receipt_id: row.id, r2_key: key, file_name: f.name, mime: f.mime, byte_size: f.bytes.byteLength });
    if (fr.error) return c.json({ error: 'save_failed', reason: fr.error.message }, 500);
  }
  if (replaces) await sb.from('staff_receipts').update({ status: 'REPLACED', updated_at: new Date().toISOString() }).eq('id', replaces.id).eq('status', 'REJECTED');
  return c.json({ id: row.id, receiptNo: row.receipt_no, route: floatId ? 'float' : 'finance' }, 201);
};

export const myReceiptsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  let q = sb.from('staff_receipts').select(RECEIPT_COLS).eq('company_id', co.companyId).eq('submitter_user_id', staffOf(c).userId);
  const m = monthRange(c.req.query('month'));
  if (m) q = q.gte('spend_date', m.from).lt('spend_date', m.to);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = ((data ?? []) as ReceiptRow[]).sort((a, b) => String(b.spend_date).localeCompare(String(a.spend_date)) || b.receipt_no.localeCompare(a.receipt_no));
  const ids = rows.map(r => r.id);
  const [lines, files, names] = await Promise.all([linesOf(sb, ids), filesOf(sb, ids), staffNames(sb)]);
  return c.json({ receipts: rows.map(r => receiptView(r, lines.get(r.id) ?? [], files.get(r.id) ?? [], names)) });
};

export const receiptFileHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const staff = staffOf(c);
  const sb = c.get('supabase');
  const { data: r } = await sb.from('staff_receipts').select('id, submitter_user_id, float_id').eq('company_id', co.companyId).eq('id', c.req.param('id')).maybeSingle();
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.submitter_user_id !== staff.userId) {
    const kept = await keptFloat(sb, co.companyId, staff);
    if (!kept || kept.id !== r.float_id) return c.json({ error: 'not_found' }, 404);
  }
  const { data: f } = await sb.from('staff_receipt_files').select('r2_key, file_name, mime').eq('receipt_id', r.id).eq('id', c.req.param('fileId')).maybeSingle();
  if (!f) return c.json({ error: 'not_found' }, 404);
  const obj = await c.env?.SLIPS?.get(f.r2_key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, { headers: { 'content-type': f.mime, 'content-disposition': `inline; filename="${String(f.file_name).replace(/"/g, '')}"`, 'cache-control': 'private, max-age=300' } });
};

export const myFloatHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const f = await keptFloat(sb, co.companyId, staffOf(c));
  if (!f) return c.json({ error: 'not_found', message: 'You do not keep a petty cash float.' }, 404);
  let q = sb.from('staff_receipts').select(RECEIPT_COLS).eq('company_id', co.companyId).eq('float_id', f.id);
  const m = monthRange(c.req.query('month') ?? todayMyt().slice(0, 7));
  if (m) q = q.gte('spend_date', m.from).lt('spend_date', m.to);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = ((data ?? []) as ReceiptRow[]).sort((a, b) => String(b.spend_date).localeCompare(String(a.spend_date)) || b.receipt_no.localeCompare(a.receipt_no));
  const ids = rows.map(r => r.id);
  const [bal, lines, files, names] = await Promise.all([floatBalances(sb, [f]), linesOf(sb, ids), filesOf(sb, ids), staffNames(sb)]);
  return c.json({
    float: { id: f.id, floatSen: Number(f.float_sen), topUpRequested: f.topup_requested_at != null, ...bal.get(f.id) },
    receipts: rows.map(r => receiptView(r, lines.get(r.id) ?? [], files.get(r.id) ?? [], names)),
  });
};

export const topUpRequestHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const f = await keptFloat(sb, co.companyId, staffOf(c));
  if (!f) return c.json({ error: 'not_found', message: 'You do not keep a petty cash float.' }, 404);
  const { error } = await sb.from('petty_cash_floats').update({ topup_requested_at: new Date().toISOString() }).eq('id', f.id);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
};

export const myJobsHandler = async (c: Ctx): Promise<Response> => {
  const staff = staffOf(c);
  let q = c.get('supabase').schema('public').from('conts_maintenance_jobs').select('id, unit_id, title, assignee_user_id, state').neq('state', 'resolved');
  if (staff.field) q = q.eq('assignee_user_id', staff.userId);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ jobs: ((data ?? []) as Array<{ id: string; unit_id: string; title: string; state: string }>).map(j => ({ id: j.id, unitId: j.unit_id, title: j.title, state: j.state })) });
};

export const unitsHandler = async (c: Ctx): Promise<Response> => {
  const { data, error } = await c.get('supabase').schema('public').from('conts_units').select('id, building, unit_number');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const units = ((data ?? []) as Array<{ id: string; building: string; unit_number: string }>).map(u => ({ id: u.id, building: u.building, unitNumber: u.unit_number }))
    .sort((a, b) => a.building.localeCompare(b.building) || a.unitNumber.localeCompare(b.unitNumber, 'en', { numeric: true }));
  return c.json({ units });
};

/** What a cost can be: the chart's active expense accounts that are not headers or control accounts. Staff choose by
 *  name; finance can change it while checking. */
export const accountsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await c.get('supabase').from('accounts').select('account_code, account_name, parent_code, special_type, account_type, is_active').eq('company_id', co.companyId).eq('is_active', true);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = (data ?? []) as Array<{ account_code: string; account_name: string; parent_code: string | null; special_type: string | null; account_type: string }>;
  const headers = new Set(rows.map(a => a.parent_code).filter(Boolean));
  const accounts = rows.filter(a => a.account_type === 'EXPENSE' && !a.special_type && !headers.has(a.account_code))
    .map(a => ({ code: a.account_code, name: a.account_name })).sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ accounts });
};

/** Projects a cost can be put on: the company's projects not archived. */
export const projectsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await c.get('supabase').schema('public').from('projects').select('id, code, name, archived_at').eq('company_id', co.companyId).is('archived_at', null);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const projects = ((data ?? []) as Array<{ id: number; code: string | null; name: string }>).map(p => ({ id: Number(p.id), code: p.code, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ projects });
};

/** Suppliers and purchase orders to ask finance to pay, by name or number. Office staff only. */
export const suppliersHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  if (staffOf(c).field) return c.json({ suppliers: [] });
  const q = String(c.req.query('q') ?? '').trim().replace(/[%,()]/g, '');
  let query = c.get('supabase').from('suppliers').select('id, code, name').eq('company_id', co.companyId);
  if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);
  const { data, error } = await query.order('name').limit(50);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ suppliers: ((data ?? []) as Array<{ id: string; code: string; name: string }>).map(s => ({ id: s.id, code: s.code, name: s.name })) });
};
export const purchaseOrdersHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  if (staffOf(c).field) return c.json({ purchaseOrders: [] });
  const q = String(c.req.query('q') ?? '').trim().replace(/[%,()]/g, '');
  let query = c.get('supabase').from('purchase_orders').select('id, po_number, supplier_id, status, total_sen, project_id').eq('company_id', co.companyId).neq('status', 'CANCELLED');
  if (q) query = query.ilike('po_number', `%${q}%`);
  const { data, error } = await query.order('po_number', { ascending: false }).limit(50);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ purchaseOrders: ((data ?? []) as Array<{ id: string; po_number: string; supplier_id: string; status: string; total_sen: number; project_id: number | null }>)
    .map(p => ({ id: p.id, poNumber: p.po_number, supplierId: p.supplier_id, status: p.status, totalSen: Number(p.total_sen ?? 0), projectId: p.project_id })) });
};

/** The staff router. `source` marks which mount it is, for the receipt's source. */
export function myClaimsRouter(source: 'session' | 'forward') {
  const r = new Hono<{ Variables: Record<string, unknown> }>();
  r.use('*', async (c, next) => { c.set('claimsSource', source); await next(); });
  r.get('/me', meHandler);
  r.post('/extract', extractHandler);
  r.post('/receipts', handInHandler);
  r.get('/receipts', myReceiptsHandler);
  r.get('/receipts/:id/files/:fileId', receiptFileHandler);
  r.get('/float', myFloatHandler);
  r.post('/float/top-up-request', topUpRequestHandler);
  r.get('/jobs', myJobsHandler);
  r.get('/units', unitsHandler);
  r.get('/accounts', accountsHandler);
  r.get('/projects', projectsHandler);
  r.get('/suppliers', suppliersHandler);
  r.get('/purchase-orders', purchaseOrdersHandler);
  myRequestRoutes(r);
  return r;
}
