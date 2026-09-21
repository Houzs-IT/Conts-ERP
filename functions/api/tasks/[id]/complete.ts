import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

/** POST /api/tasks/:id/complete { photoIds, note } — a finished turnover, deep clean or inspection flips the unit to Ready.
 *  A task that needs a photo is refused without one, unless photo storage is not set up yet (then the waiver is audited). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const b = await request.json<any>().catch(() => ({}));
  const t = await one<any>(env, `
    SELECT t.id, t.state, t.kind, t.unit_id, t.requires_photo, t.assignee_id,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photos
    FROM tasks t WHERE t.id = ?`, id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  if (isFieldRole(session.role) && t.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (t.state === 'resolved') return json({ ok: true });

  let photoWaived = false;
  if (t.requires_photo && Number(t.photos) === 0) {
    if (env.MEDIA) return fail('PHOTO_REQUIRED', 'Add at least one photo before marking this unit ready.', 422);
    photoWaived = true;
  }

  const now = nowIso();
  await run(env, "UPDATE tasks SET state = 'resolved', completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?", now, session.userId, now, id);
  if (['turnover', 'inspection', 'deep_clean', 'light_clean'].includes(t.kind)) {
    await run(env, "UPDATE units SET readiness = 'ready', updated_at = ? WHERE id = ?", now, t.unit_id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.readiness_change', entityTable: 'units', entityId: t.unit_id, after: { readiness: 'ready' }, source: 'field_app' });
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.complete', entityTable: 'tasks', entityId: id, before: { state: t.state }, after: { state: 'resolved', note: b.note ?? null, photoWaived }, source: 'field_app' });
  return json({ ok: true, photoWaived });
};
