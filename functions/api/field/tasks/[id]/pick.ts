import { type Env, one, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { taskCleanersReady, writeTaskCleaners } from '../../../../_lib/taskCleaners';
import { CLEAN_KINDS_SQL } from '../../../../_lib/cleaning';
import { cleaningNotice } from '../../../../_lib/notices';

const unassignedSql = (ready: boolean): string =>
  `t.assignee_id IS NULL AND t.cleaner_id IS NULL${ready ? ' AND NOT EXISTS (SELECT 1 FROM task_cleaners tc WHERE tc.task_id = t.id)' : ''}`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }): Promise<Response> => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'housekeeper') return fail('FORBIDDEN', 'Only cleaners pick up cleaning jobs. The office assigns them.', 403);

  const id = String(params.id);
  const current = await one<{ state: string }>(env, `SELECT state FROM tasks WHERE id = ? AND kind IN ${CLEAN_KINDS_SQL}`, id);
  if (!current) return fail('NOT_FOUND', 'That cleaning job no longer exists. Refresh the list.', 404);

  const ready = await taskCleanersReady(env);
  const roster = await one<{ id: string }>(env, 'SELECT id FROM cleaners WHERE user_id = ? AND is_active = 1', session.userId);
  const taken = await one<{ id: string }>(env, `
    UPDATE tasks t SET assignee_id = ?, cleaner_id = ?, state = CASE WHEN t.state = 'in_progress' THEN t.state ELSE 'assigned' END, updated_at = ?
    WHERE t.id = ? AND t.state <> 'resolved' AND ${unassignedSql(ready)}
    RETURNING t.id`, session.userId, roster?.id ?? null, nowIso(), id);
  if (!taken) return fail('CONFLICT', 'Someone already has this job, or it is finished. Refresh the list.', 409);

  await writeTaskCleaners(env, id, [{ cleanerId: roster?.id ?? null, userId: session.userId }], session.userId);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.assign_cleaner', entityTable: 'tasks', entityId: id,
    before: { cleanerId: null, assigneeId: null, cleaners: null, state: current.state },
    after: { cleanerId: roster?.id ?? null, assigneeId: session.userId, cleaners: session.fullName, state: 'assigned', via: 'picked_up' }, source: 'field_app',
  });
  await cleaningNotice(env, id, 'picked', session.userId, session.fullName);
  return json({ ok: true, state: 'assigned' });
};
