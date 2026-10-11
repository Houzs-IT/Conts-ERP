import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { fieldOwnsRepair } from '../../../../_lib/maintenanceTemplates';
import { notifyUsers } from '../../../../_lib/notify';

/** POST /api/maintenance/issues/:id/end { note? } — records when the repair finished, with what the technician wrote.
 *  The job is not yet resolved: completing it (with the final amount) still raises the expense, in the office.
 *  From the phone the technician must have added at least one photo or video as proof of work. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const field = isFieldRole(session.role);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const note = typeof b?.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : null;
  const cur = await one<any>(env, `
    SELECT m.id, m.state, m.started_at, m.ended_at, m.done_note, m.title, trim(coalesce(p.name, '') || ' ' || u.unit_number) AS unit
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id LEFT JOIN properties p ON p.id = u.property_id WHERE m.id = ?`, id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (!(await fieldOwnsRepair(env, session, id))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (cur.state === 'resolved') return fail('CONFLICT', 'That job is already finished.', 409);
  if (!cur.started_at) return fail('CONFLICT', 'Start the job before ending it.', 409);
  if (field) {
    const media = await one<{ n: number }>(env, `SELECT COUNT(*)::int AS n FROM documents WHERE maintenance_id = ? AND kind IN ('photo','video')`, id);
    if (!Number(media?.n)) return fail('PROOF_REQUIRED', 'Add at least one photo or video of the finished work first.', 409);
  }

  const now = nowIso();
  const endedAt = cur.ended_at ?? now;
  await run(env, `UPDATE maintenance_issues SET ended_at = ?, done_note = COALESCE(?, done_note), updated_at = ? WHERE id = ?`, endedAt, note, now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.end', entityTable: 'maintenance_issues', entityId: id, before: { startedAt: cur.started_at, note: cur.done_note ?? null }, after: { endedAt, note: note ?? cur.done_note ?? null } });
  // The office closes the job with its cost; tell them the work is done (never fails the action).
  if (field && !cur.ended_at) {
    await notifyUsers(env, 'ops_managers', {
      kind: 'maintenance.work_done', title: `Repair work done: ${cur.unit}`, body: `${cur.title}. ${session.fullName} finished the work${note ? `: ${note.slice(0, 140)}` : '.'} Close the job with its cost.`,
      link: `/operations/maintenance?id=${encodeURIComponent(id)}`, entityTable: 'maintenance_issues', entityId: id, dedupeKey: `repair-work-done-${id}`, except: session.userId,
    });
  }
  return json({ ok: true, endedAt });
};
