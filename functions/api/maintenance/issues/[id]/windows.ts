import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { toInstant } from '../../../../_lib/maintenance';
import { staysOverlapping } from '../../../../_lib/cleaning';
import { repairNotice, when } from '../../../../_lib/notices';

/** POST /api/maintenance/issues/:id/windows { startsAt, endsAt, note? } — a time the technician may enter the unit
 *  (between guests, or a slot the guest agreed). Times are Malaysian ("2026-10-10T14:00") or ISO. It is saved even
 *  when it overlaps a stay (the guest may have agreed); the answer lists the stays it overlaps so the screen warns. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot plan repair windows.', 403);

  const id = String(params.id);
  const issue = await one<{ id: string; unit_id: string; state: string }>(env, 'SELECT id, unit_id, state FROM maintenance_issues WHERE id = ?', id);
  if (!issue) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (issue.state === 'resolved') return fail('CONFLICT', 'That job is finished.', 409);

  const b = await request.json<any>().catch(() => null);
  const startsAt = toInstant(b?.startsAt), endsAt = toInstant(b?.endsAt);
  if (!startsAt) return fail('VALIDATION', 'Enter when the window starts.', 422, { startsAt: 'Pick a start.' });
  if (!endsAt) return fail('VALIDATION', 'Enter when the window ends.', 422, { endsAt: 'Pick an end.' });
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return fail('VALIDATION', 'The end must be after the start.', 422, { endsAt: 'Pick a later end.' });
  if (Date.parse(endsAt) - Date.parse(startsAt) > 14 * 864e5) return fail('VALIDATION', 'Keep one window under 14 days.', 422, { endsAt: 'Pick an earlier end.' });
  const note = typeof b?.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 300) : null;

  const wid = crypto.randomUUID();
  await run(env, `INSERT INTO maintenance_windows (id, issue_id, starts_at, ends_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    wid, id, startsAt, endsAt, note, session.userId, nowIso());
  const overlaps = await staysOverlapping(env, issue.unit_id, startsAt, endsAt);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.window_add', entityTable: 'maintenance_issues', entityId: id, after: { windowId: wid, startsAt, endsAt, note, overlaps: overlaps.length } });
  await repairNotice(env, id, 'window', session.userId, `Visit ${when(startsAt)} to ${when(endsAt).slice(-5)}${note ? ` (${note})` : ''}`);
  return json({ id: wid, startsAt, endsAt, note, overlaps }, 201);
};
