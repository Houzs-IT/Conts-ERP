import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

const CLEAN_KINDS = ['turnover', 'deep_clean', 'light_clean'];

/** PATCH /api/housekeeping/tasks/:id — reschedule OR edit the task's own details.
 *  Reschedule: { scheduledFor, dueAt } (HH:MM, Malaysia, on the task's own day).
 *  Edit:       { title, instructions, kind } — any subset; blanks the instructions
 *              when an empty string is sent. The two shapes may be combined. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot change cleaning tasks.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const ok = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

  const t = await one<{ day: string; scheduled_for: string | null; due_at: string | null; state: string; title: string; instructions: string | null; kind: string }>(env, `
    SELECT to_char((COALESCE(scheduled_for, due_at, created_at))::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS day, scheduled_for, due_at, state, title, instructions, kind
    FROM tasks WHERE id = ?`, id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);

  // Collect the column changes so a reschedule and an edit can land in one write.
  const sets: string[] = [];
  const args: unknown[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  const wantsReschedule = b?.scheduledFor != null || b?.dueAt != null;
  if (wantsReschedule) {
    if (t.state === 'resolved') return fail('CONFLICT', 'A finished task cannot be rescheduled.', 409);
    if (!ok(b?.scheduledFor) || !ok(b?.dueAt)) return fail('VALIDATION', 'Enter times as HH:MM.', 422);
    if (b.dueAt <= b.scheduledFor) return fail('VALIDATION', 'The end must be after the start.', 422, { dueAt: 'Pick a later end time.' });
    const at = (hm: string) => `${t.day}T${hm}:00+08:00`;
    sets.push('scheduled_for = ?', 'due_at = ?');
    args.push(at(b.scheduledFor), at(b.dueAt));
    before.scheduledFor = t.scheduled_for; before.dueAt = t.due_at;
    after.scheduledFor = at(b.scheduledFor); after.dueAt = at(b.dueAt);
  }

  if (typeof b?.title === 'string') {
    const title = b.title.trim();
    if (!title) return fail('VALIDATION', 'The title cannot be empty.', 422, { title: 'Give the task a title.' });
    sets.push('title = ?'); args.push(title.slice(0, 120));
    before.title = t.title; after.title = title.slice(0, 120);
  }
  if (typeof b?.instructions === 'string') {
    const instructions = b.instructions.trim() ? b.instructions.trim().slice(0, 1000) : null;
    sets.push('instructions = ?'); args.push(instructions);
    before.instructions = t.instructions; after.instructions = instructions;
  }
  if (typeof b?.kind === 'string') {
    if (!CLEAN_KINDS.includes(b.kind)) return fail('VALIDATION', 'Pick a cleaning kind.', 422, { kind: 'Turnover, deep or light clean.' });
    sets.push('kind = ?'); args.push(b.kind);
    before.kind = t.kind; after.kind = b.kind;
  }

  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);

  await run(env, `UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, nowIso(), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName,
    action: wantsReschedule && Object.keys(after).length > 2 ? 'task.edit' : wantsReschedule ? 'task.reschedule' : 'task.edit',
    entityTable: 'tasks', entityId: id, before, after,
  });
  return json({ ok: true });
};
