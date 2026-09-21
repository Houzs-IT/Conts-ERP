import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

/** PATCH /api/housekeeping/tasks/:id { scheduledFor, dueAt } — reschedule. Times are HH:MM (Malaysia) on the task's own day. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot reschedule work.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const ok = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!ok(b?.scheduledFor) || !ok(b?.dueAt)) return fail('VALIDATION', 'Enter times as HH:MM.', 422);
  if (b.dueAt <= b.scheduledFor) return fail('VALIDATION', 'The end must be after the start.', 422, { dueAt: 'Pick a later end time.' });

  const t = await one<{ day: string; scheduled_for: string | null; due_at: string | null; state: string }>(env, `
    SELECT to_char((COALESCE(scheduled_for, due_at, created_at))::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS day, scheduled_for, due_at, state
    FROM tasks WHERE id = ?`, id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  if (t.state === 'resolved') return fail('CONFLICT', 'A finished task cannot be rescheduled.', 409);

  const at = (hm: string) => `${t.day}T${hm}:00+08:00`;
  await run(env, 'UPDATE tasks SET scheduled_for = ?, due_at = ?, updated_at = ? WHERE id = ?', at(b.scheduledFor), at(b.dueAt), nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.reschedule', entityTable: 'tasks', entityId: id, before: { scheduledFor: t.scheduled_for, dueAt: t.due_at }, after: { scheduledFor: at(b.scheduledFor), dueAt: at(b.dueAt) } });
  return json({ ok: true });
};
