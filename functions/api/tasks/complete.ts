import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** POST /api/tasks/complete { taskId, note? }
 *  A turnover or inspection that completes flips the unit to Ready. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { taskId, note } = await request.json<{ taskId: string; note?: string }>();
  const task = await one<any>(env,
    `SELECT t.id, t.state, t.kind, t.unit_id, t.requires_photo, t.assignee_id,
            (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photos
     FROM tasks t WHERE t.id = ?`, taskId);
  if (!task) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);

  // Evidence gate. The UI disables the button, but the rule lives here.
  if (task.requires_photo && task.photos === 0) {
    return fail('PHOTO_REQUIRED', 'Add at least one photo before marking this unit ready.', 422);
  }

  await run(env, "UPDATE tasks SET state = 'resolved', completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?",
    nowIso(), session.userId, nowIso(), taskId);

  if (task.kind === 'turnover' || task.kind === 'inspection' || task.kind === 'deep_clean') {
    await run(env, "UPDATE units SET readiness = 'ready', updated_at = ? WHERE id = ?", nowIso(), task.unit_id);
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'unit.readiness_change',
      entityTable: 'units', entityId: task.unit_id,
      before: { readiness: 'cleaning' }, after: { readiness: 'ready' },
      source: 'field_app',
    });
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.complete',
    entityTable: 'tasks', entityId: taskId,
    before: { state: task.state }, after: { state: 'resolved', note: note ?? null },
    source: 'field_app',
  });

  return json({ ok: true });
};
