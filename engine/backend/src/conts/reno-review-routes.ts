// Conts only (not part of Houzs's code): the Reno review of a Direct pay request. A request with a line on a sub-department
// flagged reno_review waits here as RENO_REVIEW; the reviewer sends it on to finance (SUBMITTED), or sends it back (REJECTED,
// with a reason, so the asker changes it and sends it again through the usual resubmit, which comes back here).
// Mounted on the forwarded router only: Property OS decides who may review, the engine session never sees these.
//   GET  /reno-review                       the requests waiting for review, oldest first
//   GET  /reno-review/:id/files/:fileId     one of their files
//   POST /reno-review/:id/send              -> SUBMITTED; a body with the request form (as POST /requests/:id/resubmit:
//                                           { type, supplierId?, payeeName?, purchaseOrderId?, wantedOn?, amountSen, lines,
//                                           note?, owesFormalInvoice?, keepFileIds, files }) saves the reviewer's changes first
//   POST /reno-review/:id/reject            { reason } -> REJECTED
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { withTargetLabels } from './claims-lines';
import { MAX_FILES, decodeFiles, fileResponse, removeFiles, storeFiles, type Decoded } from './claims-files';
import { saveRecoveries } from './owner-recovery';
import { allRows } from './petty-cash-store';
import { REQ_COLS, claimRequest, headerOf, readRequestForm, takeReturned, views, type ReqRow } from './payment-request-routes';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const MAX_REASON_LENGTH = 500;
const now = (): string => new Date().toISOString();
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const NOT_IN_REVIEW = { error: 'not_in_review', message: 'That request is no longer waiting for review.' };

async function loadInReview(sb: any, companyId: number, id: string): Promise<ReqRow | null> {
  const { data } = await sb.from('payment_requests').select(REQ_COLS).eq('company_id', companyId).eq('id', id).eq('status', 'RENO_REVIEW').maybeSingle();
  return (data as ReqRow | null) ?? null;
}

export const renoReviewListHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const all = await allRows<ReqRow>((from, to) => sb.from('payment_requests').select(REQ_COLS).eq('company_id', co.companyId).eq('status', 'RENO_REVIEW').order('id').range(from, to));
  const rows = all.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.request_no.localeCompare(b.request_no));
  return c.json({ requests: await withTargetLabels(sb, co.companyId, await views(sb, co.companyId, rows)) });
};

export const renoReviewFileHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const request = await loadInReview(sb, co.companyId, c.req.param('id'));
  if (!request) return c.json({ error: 'not_found' }, 404);
  const { data: file } = await sb.from('payment_request_files').select('r2_key, file_name, mime').eq('request_id', request.id).eq('id', c.req.param('fileId')).maybeSingle();
  if (!file) return c.json({ error: 'not_found' }, 404);
  const stored = await c.env?.SLIPS?.get(file.r2_key);
  if (!stored) return c.json({ error: 'not_found' }, 404);
  return fileResponse(stored, file.file_name, file.mime);
};

/** The reviewer changes the request and sends it on, in the shape of the asker's own resubmit: lines and files are saved
 *  while it is still in review (taken first, so a second send finds it gone), the status moves last. */
async function sendEdited(c: Ctx, sb: any, companyId: number, reviewer: Staff, body: Record<string, unknown>): Promise<Response> {
  const bucket = c.env?.SLIPS;
  if (!bucket) return c.json({ error: 'not_configured', message: 'File storage is not set up yet.' }, 501);
  const { data: row } = await sb.from('payment_requests').select('id, request_no, status, updated_at').eq('company_id', companyId).eq('id', c.req.param('id')).eq('status', 'RENO_REVIEW').maybeSingle();
  if (!row) return c.json(NOT_IN_REVIEW, 409);
  const form = await readRequestForm(c, sb, companyId, reviewer, body);
  if (form instanceof Response) return form;

  const { data: had } = await sb.from('payment_request_files').select('id, r2_key').eq('request_id', row.id);
  const keep = new Set(Array.isArray(body.keepFileIds) ? (body.keepFileIds as unknown[]).map(String) : []);
  const files = (had ?? []) as Array<{ id: string; r2_key: string }>;
  const kept = files.filter(file => keep.has(file.id)), dropped = files.filter(file => !keep.has(file.id));
  let added: Decoded[] = [];
  if ((Array.isArray(body.files) && body.files.length > 0) || kept.length === 0) {
    const decoded = decodeFiles(body.files, 'the invoice, receipt or quotation');
    if (!decoded.ok) return c.json({ error: decoded.error, message: decoded.message }, decoded.status);
    added = decoded.files;
  }
  if (kept.length + added.length > MAX_FILES) return c.json({ error: 'validation', message: `A request holds up to ${MAX_FILES} files.` }, 422);
  const claim = await takeReturned(sb, row);
  if (!claim) return c.json(NOT_IN_REVIEW, 409);

  let stored: Awaited<ReturnType<typeof storeFiles>> = [];
  try { stored = await storeFiles(bucket, `payment-requests/${companyId}/${row.id}`, added); } catch {
    return c.json({ error: 'upload_failed', message: 'The files could not be saved. Try again.' }, 502);
  }
  const fail = async (reason: string) => {
    await removeFiles(bucket, stored.map(s => s.r2_key));
    return c.json({ error: 'save_failed', reason }, 500);
  };
  const gone = await sb.from('payment_request_lines').delete().eq('request_id', row.id);
  if (gone.error) return fail(gone.error.message);
  const inserted = await sb.from('payment_request_lines').insert(form.lines.map(l => ({ ...l, request_id: row.id })));
  if (inserted.error) return fail(inserted.error.message);
  const recoveryError = await saveRecoveries(sb, row.id, form.recover, reviewer.userId);
  if (recoveryError) return fail(recoveryError);
  if (stored.length) {
    const fileRows = await sb.from('payment_request_files').insert(stored.map(s => ({ ...s, request_id: row.id })));
    if (fileRows.error) return fail(fileRows.error.message);
  }
  const moved = await claimRequest(sb, row.id, 'RENO_REVIEW', { ...headerOf(form, body), status: 'SUBMITTED', reno_reviewed_by: reviewer.name, reno_reviewed_at: now() }, claim);
  if (!moved) return c.json(NOT_IN_REVIEW, 409);
  if (dropped.length) {
    await sb.from('payment_request_files').delete().in('id', dropped.map(file => file.id));
    await removeFiles(bucket, dropped.map(file => file.r2_key));
  }
  return c.json({ id: row.id, requestNo: row.request_no, edited: true });
}

export const renoReviewSendHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const reviewer: Staff = c.get('staff');
  const body = await bodyOf(c);
  if (body?.type !== undefined) return sendEdited(c, sb, co.companyId, reviewer, body);
  const request = await loadInReview(sb, co.companyId, c.req.param('id'));
  if (!request) return c.json(NOT_IN_REVIEW, 409);
  const moved = await claimRequest(sb, request.id, 'RENO_REVIEW', { status: 'SUBMITTED', reno_reviewed_by: reviewer.name, reno_reviewed_at: now() });
  if (!moved) return c.json(NOT_IN_REVIEW, 409);
  return c.json({ id: request.id, requestNo: request.request_no, edited: false });
};

export const renoReviewRejectHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const reviewer: Staff = c.get('staff');
  const body = await bodyOf(c);
  const reason = String(body?.reason ?? '').trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) return c.json({ error: 'validation', message: `Give the reason (up to ${MAX_REASON_LENGTH} characters).` }, 422);
  const request = await loadInReview(sb, co.companyId, c.req.param('id'));
  if (!request) return c.json(NOT_IN_REVIEW, 409);
  const moved = await claimRequest(sb, request.id, 'RENO_REVIEW', { status: 'REJECTED', reason, decided_by: reviewer.name, decided_at: now() });
  if (!moved) return c.json(NOT_IN_REVIEW, 409);
  return c.json({ id: request.id, requestNo: request.request_no });
};

export function renoReviewRoutes(r: { get: (p: string, h: (c: Ctx) => Promise<Response>) => unknown; post: (p: string, h: (c: Ctx) => Promise<Response>) => unknown }) {
  r.get('/reno-review', renoReviewListHandler);
  r.get('/reno-review/:id/files/:fileId', renoReviewFileHandler);
  r.post('/reno-review/:id/send', renoReviewSendHandler);
  r.post('/reno-review/:id/reject', renoReviewRejectHandler);
}
