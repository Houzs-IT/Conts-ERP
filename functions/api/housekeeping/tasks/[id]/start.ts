import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';

/** POST /api/housekeeping/tasks/:id/start — the cleaner (or a manager) starts the job; the unit shows Cleaning. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const t = await one<any>(env, 'SELECT id, state, unit_id, kind, assignee_id FROM tasks WHERE id = ?', id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  if (isFieldRole(session.role) && t.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (t.state === 'resolved') return fail('CONFLICT', 'That task is already finished.', 409);
  if (t.state === 'in_progress') return json({ ok: true });

  const now = nowIso();
  await run(env, "UPDATE tasks SET state = 'in_progress', started_at = COALESCE(started_at, ?), assignee_id = COALESCE(assignee_id, ?), updated_at = ? WHERE id = ?", now, session.userId, now, id);
  if (['turnover', 'deep_clean', 'light_clean'].includes(t.kind)) await run(env, "UPDATE units SET readiness = 'cleaning', updated_at = ? WHERE id = ?", now, t.unit_id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.start', entityTable: 'tasks', entityId: id, before: { state: t.state }, after: { state: 'in_progress' }, source: isFieldRole(session.role) ? 'field_app' : 'web' });
  return json({ ok: true });
};
