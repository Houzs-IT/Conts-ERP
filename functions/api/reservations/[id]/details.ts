import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { CLEAN_KINDS_SQL } from '../../../_lib/cleaning';
import { CLEAN_DAY_SQL } from '../../../_lib/cleanOverdue';
import { requireSession, isFieldRole } from '../../../_lib/auth';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** PATCH /api/reservations/:id/details { checkInTime?, checkOutTime?, staffNotes? }
 *  An early check-in or late check-out (Cleaning reads these times from the booking to plan the turnover), and the booking's
 *  internal notes. Times are ours to set on any booking, a booking site's too: they do not change the nights. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change reservations.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to change.', 422);
  const cur = await one<any>(env, 'SELECT id, unit_id, check_in, state, check_in_time, check_out_time, staff_notes FROM reservations WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const set: string[] = [], args: unknown[] = [], before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const [k, col] of [['checkInTime', 'check_in_time'], ['checkOutTime', 'check_out_time']] as const) {
    if (b[k] === undefined) continue;
    const v = String(b[k]);
    if (!TIME.test(v)) return fail('VALIDATION', 'Times are HH:MM.', 422, { [k]: 'Use HH:MM, e.g. 15:00.' });
    if (v === cur[col]) continue;
    if (['checked_out', 'cancelled', 'no_show'].includes(cur.state)) return fail('CONFLICT', 'The times of a past, cancelled or no-show reservation cannot change.', 409);
    set.push(`${col} = ?`); args.push(v); before[k] = cur[col]; after[k] = v;
  }
  if (b.staffNotes !== undefined) {
    const v = b.staffNotes === null ? null : String(b.staffNotes).trim().slice(0, 2000) || null;
    if (v !== (cur.staff_notes ?? null)) { set.push('staff_notes = ?'); args.push(v); before.staffNotes = cur.staff_notes ? 'set' : 'empty'; after.staffNotes = v ? 'set' : 'empty'; }
  }
  // The cleaning job before this arrival carries its own next-guest time (HostPlatform's, or one set before): it follows the
  // time set here, so the card, its time left and when the job turns overdue all read the new check-in (owner, 2 Nov 2026).
  const synced = b.checkInTime !== undefined && cur.unit_id && cur.check_in
    ? await all<{ id: string }>(env, `
        UPDATE tasks t SET next_guest_at = ?, updated_at = ?
        WHERE t.unit_id = ? AND t.kind IN ${CLEAN_KINDS_SQL} AND t.state != 'resolved' AND ${CLEAN_DAY_SQL('t')} = ?
          AND t.next_guest_at IS DISTINCT FROM ? RETURNING t.id`,
        `${cur.check_in}T${String(b.checkInTime)}:00+08:00`, nowIso(), cur.unit_id, cur.check_in, `${cur.check_in}T${String(b.checkInTime)}:00+08:00`)
    : [];
  if (synced.length) {
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.next_guest_time', entityTable: 'reservations', entityId: id,
      after: { checkInTime: String(b.checkInTime), tasks: synced.map(t => t.id) } });
  }
  if (!set.length) return json({ id, changed: synced.length > 0 });

  await run(env, `UPDATE reservations SET ${set.join(', ')}, updated_at = ? WHERE id = ?`, ...args, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.details', entityTable: 'reservations', entityId: id, before, after });
  return json({ id, changed: true, ...after });
};
