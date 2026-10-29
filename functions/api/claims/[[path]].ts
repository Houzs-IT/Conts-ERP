import { type Env, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { fileToUpload, forwardClaims } from '../../_lib/claimsForward';

/** /api/claims/* — a member of staff's own receipts, petty cash and payment requests, forwarded to the engine on their
 *  behalf (functions/_lib/claimsForward.ts). Only these paths pass; the engine limits every answer to the person.
 *    GET  me, receipts, receipts/:id/files/:fileId, float, jobs, units, accounts, projects   (everyone)
 *    GET  requests, suppliers, purchase-orders                                                (office staff)
 *    POST extract, receipts            multipart: `data` (JSON) and `file` (one or more)       (everyone)
 *    POST float/top-up-request                                                                (a float's keeper)
 *    POST requests (multipart), requests/:id/withdraw                                         (office staff) */
const GET_ANYONE = /^(me|receipts|receipts\/[^/]+\/files\/[^/]+|float|jobs|units|accounts|projects)$/;
const GET_OFFICE = /^(requests|suppliers|purchase-orders)$/;
const MAX_FILES = 8;
const MAX_BYTES = 25 * 1024 * 1024;

const pathOf = (params: Record<string, string | string[]>) => (Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? ''));

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const path = pathOf(params);
  const field = isFieldRole(session.role);
  if (!GET_ANYONE.test(path) && (field || !GET_OFFICE.test(path))) return fail('NOT_FOUND', 'Not found.', 404);
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

  if (path === 'extract' || path === 'receipts' || (path === 'requests' && !field)) {
    const form = await readForm(request);
    if (form instanceof Response) return form;
    const files = await Promise.all(form.files.map(fileToUpload));
    const res = await forwardClaims(env, session, 'POST', `/${path}`, { ...form.data, files });
    if (res.ok && path !== 'extract') {
      const made = await res.clone().json<{ id?: string; receiptNo?: string; requestNo?: string }>().catch(() => null);
      await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: path === 'receipts' ? 'claims.receipt' : 'claims.request',
        entityTable: path === 'receipts' ? 'staff_receipts' : 'payment_requests', entityId: String(made?.id ?? ''),
        after: { no: made?.receiptNo ?? made?.requestNo, amountSen: form.data.amountSen, files: files.length }, source });
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
