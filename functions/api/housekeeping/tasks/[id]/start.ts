import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { isOnTask } from '../../../../_lib/taskCleaners';
import { noOpenBlockerSql } from '../../../../_lib/maintenance';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { MYT_DATE } from '../../../../_lib/ops';
import { CLEAN_KINDS_SQL, LIVE_STAY_SQL } from '../../../../_lib/cleaning';

/** POST /api/housekeeping/tasks/:id/start — the cleaner (or a manager) starts the job; the unit shows Cleaning.
 *  A clean after a departing stay starts only once the guest is out (ticked, or the booking Checked out): since the
 *  automatic guest-out mark went (26 Oct 2026) nothing else stops a start while the guest is still in the unit. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const t = await one<any>(env, 'SELECT id, state, unit_id, kind, assignee_id FROM tasks WHERE id = ?', id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  if (isFieldRole(session.role) && !(await isOnTask(env, t.id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (t.state === 'resolved') return fail('CONFLICT', 'That task is already finished.', 409);
  if (t.state === 'in_progress') return json({ ok: true });
  // The departing stay is found exactly as the board and the cleaner's Today page find it, so the rule matches the screen.
  const day = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const guestIn = await one<{ x: number }>(env, `
    SELECT 1 AS x FROM tasks t
    JOIN LATERAL (
      SELECT r.state FROM reservations r
      WHERE (r.id = t.reservation_id) OR (t.reservation_id IS NULL AND r.unit_id = t.unit_id AND r.check_out = ${day} AND ${LIVE_STAY_SQL('r')})
      ORDER BY (r.id = t.reservation_id) DESC LIMIT 1
    ) prev ON TRUE
    WHERE t.id = ? AND t.kind IN ${CLEAN_KINDS_SQL} AND t.guest_left_at IS NULL AND prev.state <> 'checked_out'`, id);
  if (guestIn) return fail('GUEST_IN', 'The guest is not marked out yet. Tap Guest has left first, then start.', 409);

  const now = nowIso();
  await run(env, "UPDATE tasks SET state = 'in_progress', started_at = COALESCE(started_at, ?), assignee_id = COALESCE(assignee_id, ?), updated_at = ? WHERE id = ?", now, session.userId, now, id);
  if (['turnover', 'deep_clean', 'light_clean'].includes(t.kind)) await run(env, `UPDATE units SET readiness = 'cleaning', updated_at = ? WHERE id = ? AND ${noOpenBlockerSql('units.id')}`, now, t.unit_id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.start', entityTable: 'tasks', entityId: id, before: { state: t.state }, after: { state: 'in_progress' }, source: isFieldRole(session.role) ? 'field_app' : 'web' });
  return json({ ok: true });
};
