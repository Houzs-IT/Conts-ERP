import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';
import { CLEAN_KINDS_SQL, LIVE_STAY_SQL, mytToday } from '../../_lib/cleaning';
import { bookingNotice } from '../../_lib/notices';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** POST /api/housekeeping/guest-left { taskId } | { reservationId } | { taskId, undo: true }
 *  The departing guest has gone: the clean shows "Guest out, ready to clean" at once. A booking still Checked in
 *  moves to Checked out (as the booking screen's Check out does; its clean already exists, so none is added).
 *  Given a departing booking with no clean yet, the turnover clean is created here. Undo only clears the mark
 *  on the clean; it does not reopen the booking. Field staff may do this on their own jobs. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const field = isFieldRole(session.role);

  const b = await request.json<any>().catch(() => null);
  const now = nowIso();
  const day = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');

  let task = typeof b?.taskId === 'string' && b.taskId
    ? await one<any>(env, `SELECT t.id, t.unit_id, t.state, t.kind, t.reservation_id, t.assignee_id, t.guest_left_at, ${day} AS day FROM tasks t WHERE t.id = ?`, b.taskId)
    : null;
  if (b?.taskId && !task) return fail('NOT_FOUND', 'That cleaning job no longer exists. Refresh the list.', 404);

  let reservation: { id: string; unit_id: string; state: string; check_out: string; check_out_time: string | null } | null = null;
  if (typeof b?.reservationId === 'string' && b.reservationId) {
    reservation = await one<any>(env, `SELECT r.id, r.unit_id, r.state, r.check_out, r.check_out_time FROM reservations r WHERE r.id = ? AND ${LIVE_STAY_SQL('r')}`, b.reservationId);
    if (!reservation) return fail('NOT_FOUND', 'That reservation does not exist or was cancelled.', 404);
  }
  if (!task && !reservation) return fail('VALIDATION', 'Say which cleaning job or reservation.', 422);
  // Nobody can have left a stay that ends on a later day: that would check the booking out early and dirty the unit.
  const leaves = reservation?.check_out ?? task?.day;
  if (b?.undo !== true && leaves && leaves > mytToday()) {
    return fail('NOT_YET', `This guest checks out on ${Number(leaves.slice(8, 10))} ${MONTHS[Number(leaves.slice(5, 7)) - 1]}. Mark them out on the day, or change the reservation's dates if they left early.`, 409);
  }
  if (field && (!task || task.assignee_id !== session.userId)) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  if (b?.undo === true) {
    if (!task) return fail('VALIDATION', 'Say which cleaning job.', 422);
    if (field) return fail('FORBIDDEN', 'Ask the office to undo this.', 403);
    await run(env, 'UPDATE tasks SET guest_left_at = NULL, updated_at = ? WHERE id = ?', now, task.id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.guest_left_undo', entityTable: 'tasks', entityId: task.id, before: { guestLeftAt: task.guest_left_at } });
    return json({ ok: true, taskId: task.id, guestLeftAt: null });
  }

  // The clean for a booking: its own, else the clean on that unit that day, else a new turnover.
  let created = false;
  if (!task && reservation) {
    task = await one<any>(env, `
      SELECT t.id, t.unit_id, t.state, t.kind, t.reservation_id, t.assignee_id, t.guest_left_at, ${day} AS day FROM tasks t
      WHERE t.kind IN ${CLEAN_KINDS_SQL} AND (t.reservation_id = ? OR (t.unit_id = ? AND ${day} = ?))
      ORDER BY (t.reservation_id = ?) DESC LIMIT 1`, reservation.id, reservation.unit_id, reservation.check_out, reservation.id);
    if (!task) {
      const id = crypto.randomUUID();
      const next = await one<{ check_in_time: string | null }>(env, `
        SELECT n.check_in_time FROM reservations n WHERE n.unit_id = ? AND n.check_in = ? AND n.id != ? AND ${LIVE_STAY_SQL('n')} LIMIT 1`,
        reservation.unit_id, reservation.check_out, reservation.id);
      const due = next?.check_in_time ? `${reservation.check_out}T${next.check_in_time}:00+08:00` : null;
      await run(env, `
        INSERT INTO tasks (id, unit_id, reservation_id, kind, state, title, scheduled_for, due_at, next_guest_at, requires_photo, guest_left_at, created_at, updated_at)
        VALUES (?, ?, ?, 'turnover', 'open', 'Turnover after check-out', ?, ?, ?, 1, ?, ?, ?)`,
        id, reservation.unit_id, reservation.id, `${reservation.check_out}T${reservation.check_out_time || '11:00'}:00+08:00`, due, due, now, now, now);
      await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.create', entityTable: 'tasks', entityId: id, after: { unitId: reservation.unit_id, reservationId: reservation.id, kind: 'turnover', via: 'guest_left' } });
      task = { id, unit_id: reservation.unit_id, state: 'open', kind: 'turnover', reservation_id: reservation.id, assignee_id: null, guest_left_at: null, day: reservation.check_out };
      created = true;
    }
  }
  if (task.state === 'resolved') return fail('CONFLICT', 'That cleaning job is already finished.', 409);

  const leftAt = task.guest_left_at ?? now;
  await run(env, 'UPDATE tasks SET guest_left_at = ?, updated_at = ? WHERE id = ?', leftAt, now, task.id);
  // The unit needs cleaning now, unless someone is already at it or it is out of service.
  await run(env, `UPDATE units SET readiness = 'dirty', updated_at = ? WHERE id = ? AND readiness IN ('occupied','ready')`, now, task.unit_id);

  // The departing booking, if it is still Checked in, is now Checked out.
  reservation ??= task.reservation_id
    ? await one<any>(env, 'SELECT id, unit_id, state, check_out, check_out_time FROM reservations WHERE id = ?', task.reservation_id)
    : await one<any>(env, `SELECT r.id, r.unit_id, r.state, r.check_out, r.check_out_time FROM reservations r WHERE r.unit_id = ? AND r.check_out = ? AND ${LIVE_STAY_SQL('r')} ORDER BY r.check_out_time DESC LIMIT 1`, task.unit_id, task.day);
  let checkedOut = false;
  if (reservation?.state === 'checked_in') {
    const moved = await one(env, `UPDATE reservations SET state = 'checked_out', updated_at = ? WHERE id = ? AND state = 'checked_in' RETURNING id`, now, reservation.id);
    if (moved) {
      checkedOut = true;
      await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.status', entityTable: 'reservations', entityId: reservation.id, before: { state: 'checked_in' }, after: { state: 'checked_out', via: 'cleaning.guest_left' }, source: field ? 'field_app' : 'web' });
    }
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.guest_left', entityTable: 'tasks', entityId: task.id, after: { guestLeftAt: leftAt, reservationId: reservation?.id ?? null, checkedOut, created }, source: field ? 'field_app' : 'web' });
  // Whoever has the clean, and operations, learn the unit is free to clean (once per booking or clean).
  if (reservation) await bookingNotice(env, reservation.id, 'checked_out', session.userId);
  return json({ ok: true, taskId: task.id, guestLeftAt: leftAt, bookingCheckedOut: checkedOut, cleanCreated: created });
};
