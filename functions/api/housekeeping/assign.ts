import { type Env, one, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { notify } from '../../_lib/notify';

/** POST /api/housekeeping/assign { taskId, assigneeId, force? } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { taskId, assigneeId, force } = await request.json<{ taskId: string; assigneeId: string; force?: boolean }>();
  if (!taskId || !assigneeId) return fail('VALIDATION', 'Task and assignee are required.', 422);

  const task = await one<any>(env, 'SELECT id, state, assignee_id, due_at, unit_id FROM tasks WHERE id = ?', taskId);
  if (!task) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);

  const assignee = await one<{ id: string; full_name: string }>(env,
    'SELECT id, full_name FROM users WHERE id = ? AND is_active = 1', assigneeId);
  if (!assignee) return fail('NOT_FOUND', 'That cleaner is no longer active.', 404);

  // Overlapping work is a warning, not a hard block — operations sometimes
  // double-books deliberately. Confirming with force:true proceeds.
  if (!force && task.due_at) {
    const clash = await all<{ id: string; due_at: string }>(env, `
      SELECT id, due_at FROM tasks
      WHERE assignee_id = ? AND id != ? AND state NOT IN ('resolved')
        AND abs(julianday(due_at) - julianday(?)) < 0.0625`,
      assigneeId, taskId, task.due_at);
    if (clash.length) {
      return json({
        error: {
          code: 'ASSIGNEE_BUSY',
          message: `${assignee.full_name} has ${clash.length} overlapping ${clash.length === 1 ? 'task' : 'tasks'} around that time. Assign anyway?`,
        },
        conflicts: clash,
      }, 409);
    }
  }

  await run(env, "UPDATE tasks SET assignee_id = ?, state = 'assigned', updated_at = ? WHERE id = ?",
    assigneeId, nowIso(), taskId);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.assign',
    entityTable: 'tasks', entityId: taskId,
    before: { assigneeId: task.assignee_id, state: task.state },
    after: { assigneeId, state: 'assigned' },
  });
  const unit = await one<{ unit_number: string; property_name: string; phone: string | null }>(env, `
    SELECT u.unit_number, p.name AS property_name, a.phone
    FROM units u JOIN properties p ON p.id = u.property_id, users a
    WHERE u.id = ? AND a.id = ?`, task.unit_id, assigneeId);

  // Field notifications carry the unit, the time and the address — never money.
  const delivery = await notify(env, {
    template: 'field.task_assigned',
    recipient: unit?.phone ?? assignee.full_name,
    channel: 'push',
    body: `New job: ${unit?.property_name} ${unit?.unit_number}${task.due_at ? `, due ${task.due_at.slice(11, 16)}` : ''}.`,
    entityTable: 'tasks', entityId: taskId,
    urgent: true,
  });

  return json({ ok: true, assigneeName: assignee.full_name, notified: delivery.state });
};
