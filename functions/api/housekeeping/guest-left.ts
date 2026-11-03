import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { isOnTask } from '../../_lib/taskCleaners';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';
import { LIVE_STAY_SQL, mytToday } from '../../_lib/cleaning';
import { markGuestLeft } from '../../_lib/guestLeft';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** POST /api/housekeeping/guest-left { taskId } | { reservationId } | { taskId, undo: true }
 *  The departing guest has gone: the clean shows "Guest out, ready to clean" at once. A booking still Checked in
 *  moves to Checked out (as the booking screen's Check out does; its clean already exists, so none is added).
 *  Given a departing booking with no clean yet, the turnover clean is created here. Undo clears the mark and, when
 *  this tap is what checked the booking out, puts it back to Checked in. Field staff may do this on their own jobs. */
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
  if (field && (!task || !(await isOnTask(env, task.id, session.userId)))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  if (b?.undo === true) {
    if (!task) return fail('VALIDATION', 'Say which cleaning job.', 422);
    if (field) return fail('FORBIDDEN', 'Ask the office to undo this.', 403);
    // The board counts a Checked out booking as out, so clearing the mark alone would not take it back.
    const booking = task.reservation_id
      ? await one<any>(env, 'SELECT id, state FROM reservations WHERE id = ?', task.reservation_id)
      : await one<any>(env, `SELECT r.id, r.state FROM reservations r WHERE r.unit_id = ? AND r.check_out = ? AND ${LIVE_STAY_SQL('r')} ORDER BY r.check_out_time DESC LIMIT 1`, task.unit_id, task.day);
    let bookingReopened = false;
    if (booking?.state === 'checked_out') {
      const lastStatusChange = await one<{ after_state: string | null }>(env, `
        SELECT l.after_state FROM audit_log l WHERE l.entity_table = 'reservations' AND l.entity_id = ? AND l.action = 'reservation.status'
        ORDER BY l.occurred_at DESC LIMIT 1`, booking.id);
      const checkedOutByGuestLeftTap = !!lastStatusChange?.after_state?.includes('cleaning.guest_left');
      if (!checkedOutByGuestLeftTap) {
        return fail('CONFLICT', 'This reservation is checked out on the reservation screen. Undo the checkout there.', 409);
      }
      bookingReopened = !!(await one(env, `UPDATE reservations SET state = 'checked_in', updated_at = ? WHERE id = ? AND state = 'checked_out' RETURNING id`, now, booking.id));
      if (bookingReopened) {
        await run(env, `UPDATE units SET readiness = 'occupied', updated_at = ? WHERE id = ? AND readiness = 'dirty'`, now, task.unit_id);
        await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.status', entityTable: 'reservations', entityId: booking.id, before: { state: 'checked_out' }, after: { state: 'checked_in', via: 'cleaning.guest_left_undo' } });
      }
    }
    await run(env, 'UPDATE tasks SET guest_left_at = NULL, updated_at = ? WHERE id = ?', now, task.id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.guest_left_undo', entityTable: 'tasks', entityId: task.id, before: { guestLeftAt: task.guest_left_at }, after: { bookingReopened } });
    return json({ ok: true, taskId: task.id, guestLeftAt: null, bookingReopened });
  }

  // The clean for a booking: its own, else the clean on that unit that day, else a new turnover (lib/guestLeft, the same
  // action the automatic mark at the checkout time takes).
  if (task?.state === 'resolved') return fail('CONFLICT', 'That cleaning job is already finished.', 409);
  const done = await markGuestLeft(env, { task, reservation, actor: { id: session.userId, label: session.fullName, source: field ? 'field_app' : 'web' } });
  if (!done) return fail('CONFLICT', 'That cleaning job is already finished.', 409);
  return json({ ok: true, taskId: done.taskId, guestLeftAt: done.leftAt, bookingCheckedOut: done.checkedOut, cleanCreated: done.created });
};

