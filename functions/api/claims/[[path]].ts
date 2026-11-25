import { type Env, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { mayReviewRenoClaims } from '../../_lib/access';
import { fileToUpload, forwardClaims } from '../../_lib/claimsForward';

/** /api/claims/* — a member of staff's own receipts, petty cash and payment requests, forwarded to the engine on their
 *  behalf (functions/_lib/claimsForward.ts). Only these paths pass; the engine limits every answer to the person.
 *    GET  me, my-bank, receipts, receipts/:id/files/:fileId, requests, requests/:id/files/:fileId, float, jobs, units,
 *         accounts, projects                                                                  (everyone;
 *         requests are the person's own: a field worker sees what became of a Direct Pay to Supplier)
 *    GET  suppliers, purchase-orders                                                          (office staff)
 *    POST extract, receipts            multipart: `data` (JSON) and `file` (one or more)       (everyone)
 *    POST requests (multipart)                                                                (everyone; a field worker
 *         asks finance to pay a supplier by the name on the bill only: Direct Pay to Supplier, chew 12 Nov 2026)
 *    POST float/top-up-request                                                                (a float's keeper)
 *    POST requests/:id/withdraw                                                               (office staff)
 *    POST requests/:id/resubmit (multipart): a withdrawn or rejected request changed and sent again, the same number
 *         (chew, 13 Nov 2026)                                                                 (office staff)
 *    POST requests/:id/balance (multipart): the rest of a paid deposit's AP invoice, nothing filled in again; the formal
 *         invoice may come with it (chew, 15 Nov 2026)                                         (office staff)
 *    GET  reno-review, reno-review/:id/files/:fileId                                          (Review renovation claims)
 *    POST reno-review/:id/send (multipart, as `receipts`: every field of the claim, `keepFileIds`, new `file`s),
 *         reno-review/:id/reject (JSON `reason`)                                              (Review renovation claims) */
const GET_ANYONE = /^(me|my-bank|receipts|receipts\/[^/]+\/files\/[^/]+|requests|requests\/[^/]+\/files\/[^/]+|float|jobs|units|accounts|projects|sub-departments)$/;
const GET_RENO_REVIEW = /^reno-review(\/[^/]+\/files\/[^/]+)?$/;
const POST_RENO_REVIEW = /^reno-review\/[^/]+\/(send|reject)$/;
const GET_OFFICE = /^(suppliers|purchase-orders)$/;
const MAX_FILES = 8;
const MAX_BYTES = 25 * 1024 * 1024;

const pathOf = (params: Record<string, string | string[]>) => (Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? ''));

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const path = pathOf(params);
  const field = isFieldRole(session.role);
  if (!GET_ANYONE.test(path) && !GET_RENO_REVIEW.test(path) && (field || !GET_OFFICE.test(path))) return fail('NOT_FOUND', 'Not found.', 404);
  if (GET_RENO_REVIEW.test(path) && (field || !mayReviewRenoClaims(session))) return fail('NOT_FOUND', 'Not found.', 404);
  const search = new URL(request.url).search;
  return forwardClaims(env, session, 'GET', `/${path}${search}`);
};

/** The files and the JSON `data` field of a multipart post. */
async function readForm(request: Request): Promise<{ data: Record<string, unknown>; files: File[] } | Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return fail('VALIDATION', 'Send the form with its files.', 422);
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(String(form.get('data') ?? '{}')) as Record<string, unknown>; } catch { return fail('VALIDATION', 'The form could not be read.', 422); }
  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (files.length > MAX_FILES) return fail('VALIDATION', `Up to ${MAX_FILES} files.`, 422);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return fail('VALIDATION', 'The files together must be under 25 MB.', 422);
  return { data, files };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const path = pathOf(params);
  const field = isFieldRole(session.role);
  const source = field ? 'field_app' : 'web';

  if (POST_RENO_REVIEW.test(path)) {
    if (field || !mayReviewRenoClaims(session)) return fail('NOT_FOUND', 'Not found.', 404);
    const [, receiptId = '', step] = path.split('/');
    const sending = step === 'send';
    let payload: Record<string, unknown>;
    if (sending) {
      const form = await readForm(request);
      if (form instanceof Response) return form;
      payload = { ...form.data, files: await Promise.all(form.files.map(fileToUpload)) };
    } else {
      const body = await request.json<{ reason?: unknown }>().catch(() => null);
      if (!body) return fail('VALIDATION', 'Send a JSON body.', 422);
      payload = { reason: body.reason };
    }
    const res = await forwardClaims(env, session, 'POST', `/${path}`, payload);
    if (res.ok) {
      await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: sending ? 'claims.reno_review_sent' : 'claims.reno_review_rejected',
        entityTable: 'staff_receipts', entityId: receiptId, ...(sending ? {} : { after: { reason: payload.reason } }), source });
    }
    return res;
  }

  const resubmit = !field && /^requests\/[^/]+\/resubmit$/.test(path);
  const balance = !field && /^requests\/[^/]+\/balance$/.test(path);
  if (path === 'extract' || path === 'receipts' || path === 'requests' || resubmit || balance) {
    const form = await readForm(request);
    if (form instanceof Response) return form;
    const files = await Promise.all(form.files.map(fileToUpload));
    const res = await forwardClaims(env, session, 'POST', `/${path}`, { ...form.data, files });
    if (res.ok && path !== 'extract') {
      const made = await res.clone().json<{ id?: string; receiptNo?: string; requestNo?: string; amountSen?: number }>().catch(() => null);
      await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: path === 'receipts' ? 'claims.receipt' : resubmit ? 'claims.request_resubmitted' : balance ? 'claims.request_balance' : 'claims.request',
        entityTable: path === 'receipts' ? 'staff_receipts' : 'payment_requests', entityId: String(made?.id ?? ''),
        after: { no: made?.receiptNo ?? made?.requestNo, amountSen: form.data.amountSen ?? made?.amountSen, files: files.length,
          ...(balance ? { depositRequestId: path.split('/')[1] } : {}) }, source });
    }
    return res;
  }
  if (path === 'float/top-up-request' || (!field && /^requests\/[^/]+\/withdraw$/.test(path))) {
    const res = await forwardClaims(env, session, 'POST', `/${path}`, {});
    if (res.ok) {
      await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: path === 'float/top-up-request' ? 'claims.top_up_asked' : 'claims.request_withdrawn',
        entityTable: path === 'float/top-up-request' ? 'petty_cash_floats' : 'payment_requests', entityId: path.split('/')[1] ?? '', source });
    }
    return res;
  }
  return fail('NOT_FOUND', 'Not found.', 404);
};
