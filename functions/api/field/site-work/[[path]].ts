import { type Env, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { forwardToEngine } from '../../../_lib/claimsForward';

/** /api/field/site-work/* is the renovator's Jobs tab: the engine's site task list and units done, forwarded on their
 *  behalf (functions/_lib/claimsForward.ts). The engine limits every answer to the renovator's brand.
 *    GET jobs
 *    PUT lines/:id/progress   body { doneQty } */
const PROGRESS_PATH = /^lines\/[A-Za-z0-9-]+\/progress$/;
const NOT_CONFIGURED = 'Jobs are not set up on this environment yet.';

const pathOf = (params: Record<string, string | string[]>): string => (Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? ''));

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'renovator') return fail('FORBIDDEN', 'Jobs are for Renovation staff.', 403);
  if (pathOf(params) !== 'jobs') return fail('NOT_FOUND', 'Not found.', 404);
  return forwardToEngine(env, session, 'site-forward', NOT_CONFIGURED, 'GET', '/jobs');
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'renovator') return fail('FORBIDDEN', 'Jobs are for Renovation staff.', 403);
  const path = pathOf(params);
  if (!PROGRESS_PATH.test(path)) return fail('NOT_FOUND', 'Not found.', 404);
  const body = await request.json<{ doneQty?: unknown }>().catch(() => null);
  if (typeof body?.doneQty !== 'number' || !Number.isFinite(body.doneQty)) return fail('VALIDATION', 'Send the count as a number.', 422);
  return forwardToEngine(env, session, 'site-forward', NOT_CONFIGURED, 'PUT', `/${path}`, { doneQty: body.doneQty });
};
