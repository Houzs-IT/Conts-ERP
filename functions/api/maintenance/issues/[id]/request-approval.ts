import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { repairNotice } from '../../../../_lib/notices';

/** POST /api/maintenance/issues/:id/request-approval — puts the quote in front of the owner; work waits until they decide. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot request approval.', 403);

  const id = String(params.id);
  const cur = await one<any>(env, 'SELECT id, state, quoted_amount, owner_approved_at FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (cur.state === 'resolved') return fail('CONFLICT', 'That job is already finished.', 409);
  if (cur.quoted_amount == null) return fail('VALIDATION', 'Add a quote before asking the owner to approve.', 422);

  await run(env, `UPDATE maintenance_issues SET owner_approval_required = 1, owner_approved_at = NULL, state = 'waiting', updated_at = ? WHERE id = ?`, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.request_approval', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state }, after: { state: 'waiting' } });
  await repairNotice(env, id, 'approval_requested', session.userId);
  return json({ ok: true });
};
