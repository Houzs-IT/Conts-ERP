import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { isAssignee } from '../../../../_lib/maintenance';

/** POST /api/maintenance/issues/:id/start — records when the repair actually began.
 *  Approval gates the start: work waiting on an owner's decision cannot begin. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const field = isFieldRole(session.role);

  const id = String(params.id);
  const cur = await one<any>(env, 'SELECT id, state, started_at, charge_to, owner_approval_required, owner_approved_at FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (field && !(await isAssignee(env, id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (cur.state === 'resolved') return fail('CONFLICT', 'That job is already finished.', 409);
  if (cur.owner_approval_required && !cur.owner_approved_at && cur.charge_to === 'owner') {
    return fail('APPROVAL_PENDING', 'The owner has not approved this quote yet. Work cannot start.', 409);
  }
  const now = nowIso();
  // Idempotent: the first start wins so a double-tap does not reset the clock.
  const startedAt = cur.started_at ?? now;
  await run(env, `UPDATE maintenance_issues SET started_at = ?, ended_at = NULL, state = 'in_progress', updated_at = ? WHERE id = ?`, startedAt, now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.start', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state }, after: { state: 'in_progress', startedAt }, source: field ? 'field_app' : 'web' });
  return json({ ok: true, startedAt });
};
