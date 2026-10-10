import { type Env, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { VIEW_SQL, decideContext, toView, decide, type Decision } from '../../_lib/approvals';

/** GET /api/approvals/:id — one request with what this person may do with it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Approvals are for management, finance and operations managers.', 403);
  const row = await one<any>(env, `${VIEW_SQL} WHERE a.id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That request no longer exists.', 404);
  return json(toView(row, session, await decideContext(env)));
};

/** POST /api/approvals/:id { decision: 'approve' | 'reject' | 'cancel', note? }
 *  approve  carries the staged money action out and records the decision, in one transaction. A note is required
 *           when the only management user approves their own request.
 *  reject   a note saying why is required. Nothing else changes.
 *  cancel   the requester (or management) withdraws it. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Approvals are for management, finance and operations managers.', 403);
  const b = await request.json<{ decision?: string; note?: string }>().catch(() => null);
  const decision = b?.decision;
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'cancel') return fail('VALIDATION', 'Choose approve, reject or cancel.', 422);
  const r = await decide(env, session, String(params.id), decision as Decision, typeof b?.note === 'string' ? b.note : null);
  if (!r.ok) return fail(r.code, r.message, r.status, r.code === 'VALIDATION' ? { note: r.message } : undefined);
  return json(r.view);
};
