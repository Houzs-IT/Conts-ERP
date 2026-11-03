import { type Env, one, all, run, audit, nowIso } from './db';
import { MYT_DATE } from './ops';
import { CLEAN_KINDS_SQL, LIVE_STAY_SQL } from './cleaning';
import { bookingNotice } from './notices';
import { cleaningCheckoutSql } from './lateCheckout';

/* "Guest has left", one action for the staff tap (functions/api/housekeeping/guest-left.ts) and the automatic mark at
   the checkout time (autoGuestLeft, run by the cron worker): the clean shows Ready to clean, the unit turns dirty, a
   booking still Checked in moves to Checked out, the same audit rows and the same notice. */

const DAY = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');

export interface LeftTask { id: string; unit_id: string; state: string; kind: string; reservation_id: string | null; assignee_id: string | null; guest_left_at: string | null; day: string }
export interface LeftBooking { id: string; unit_id: string; state: string; check_out: string; check_out_time: string | null }
export interface LeftActor { id: string | null; label: string; source: 'web' | 'field_app' | 'system' }

export const leftTask = (env: Env, id: string) =>
  one<LeftTask>(env, `SELECT t.id, t.unit_id, t.state, t.kind, t.reservation_id, t.assignee_id, t.guest_left_at, ${DAY} AS day FROM tasks t WHERE t.id = ?`, id);

/**
 * Marks the departing guest out. Given only a booking, its clean is found (its own, else the clean on that unit that
 * day) or a turnover is created. `leftAt` is the moment recorded: now for a tap; the checkout time, in +08:00 form, for
 * the automatic mark (the board tells the two apart by that form). Null when the clean is already finished.
 */
export async function markGuestLeft(env: Env, input: { task: LeftTask | null; reservation: LeftBooking | null; actor: LeftActor; leftAt?: string; auto?: boolean }) {
  const now = nowIso();
  const { actor } = input;
  let { task, reservation } = input;
  let created = false;
  if (!task && reservation) {
    task = await one<LeftTask>(env, `
      SELECT t.id, t.unit_id, t.state, t.kind, t.reservation_id, t.assignee_id, t.guest_left_at, ${DAY} AS day FROM tasks t
      WHERE t.kind IN ${CLEAN_KINDS_SQL} AND (t.reservation_id = ? OR (t.unit_id = ? AND ${DAY} = ?))
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
      await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'housekeeping.create', entityTable: 'tasks', entityId: id, after: { unitId: reservation.unit_id, reservationId: reservation.id, kind: 'turnover', via: 'guest_left' }, source: actor.source });
      task = { id, unit_id: reservation.unit_id, state: 'open', kind: 'turnover', reservation_id: reservation.id, assignee_id: null, guest_left_at: null, day: reservation.check_out };
      created = true;
    }
  }
  if (!task || task.state === 'resolved') return null;

  // Only the first mark counts: a tap after the automatic one (or the other way round) changes nothing.
  const marked = await one<{ guest_left_at: string }>(env, `UPDATE tasks SET guest_left_at = COALESCE(guest_left_at, ?), updated_at = ? WHERE id = ? RETURNING guest_left_at`, input.leftAt ?? now, now, task.id);
  const leftAt = marked?.guest_left_at ?? input.leftAt ?? now;
  // The unit needs cleaning now, unless someone is already at it or it is out of service.
  await run(env, `UPDATE units SET readiness = 'dirty', updated_at = ? WHERE id = ? AND readiness IN ('occupied','ready')`, now, task.unit_id);

  // The departing booking, if it is still Checked in, is now Checked out.
  reservation ??= task.reservation_id
    ? await one<LeftBooking>(env, 'SELECT id, unit_id, state, check_out, check_out_time FROM reservations WHERE id = ?', task.reservation_id)
    : await one<LeftBooking>(env, `SELECT r.id, r.unit_id, r.state, r.check_out, r.check_out_time FROM reservations r WHERE r.unit_id = ? AND r.check_out = ? AND ${LIVE_STAY_SQL('r')} ORDER BY r.check_out_time DESC LIMIT 1`, task.unit_id, task.day);
  let checkedOut = false;
  if (reservation?.state === 'checked_in') {
    const moved = await one(env, `UPDATE reservations SET state = 'checked_out', updated_at = ? WHERE id = ? AND state = 'checked_in' RETURNING id`, now, reservation.id);
    if (moved) {
      checkedOut = true;
      // via stays 'cleaning.guest_left' so the board's Undo can put the booking back (guest-left.ts).
      await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'reservation.status', entityTable: 'reservations', entityId: reservation.id, before: { state: 'checked_in' }, after: { state: 'checked_out', via: 'cleaning.guest_left', ...(input.auto ? { auto: true } : {}) }, source: actor.source });
    }
  }
  await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'task.guest_left', entityTable: 'tasks', entityId: task.id, after: { guestLeftAt: leftAt, reservationId: reservation?.id ?? null, checkedOut, created, ...(input.auto ? { auto: true } : {}) }, source: actor.source });
  // Whoever has the clean, and operations, learn the unit is free to clean (once per booking or clean).
  if (reservation) await bookingNotice(env, reservation.id, 'checked_out', actor.id);
  return { taskId: task.id, leftAt, checkedOut, created };
}

export interface DueDeparture { id: string; unit_id: string; state: string; check_out: string; check_out_time: string | null; out_at: string; late: boolean; task_id: string | null }

/**
 * The departures due an automatic "Guest has left" at `now` (owner, 2 Nov 2026): checking out today (Malaysia), the
 * checkout time passed (the late checkout's when one is requested or paid, else the booking's, else the standard
 * checkout), and not marked yet: no mark on its clean, the booking not Checked out, the clean not finished, and nobody
 * pressed Undo on it (staff undoing the mark wins). A booking with no clean gets one only when the board would list it
 * as a checkout to plan (not an owner stay, no cancelled clean).
 */
export async function dueDepartures(env: Env, now: number, limit = 40): Promise<DueDeparture[]> {
  const today = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  const nowHm = new Date(now + 8 * 3600e3).toISOString().slice(11, 16);
  const set = await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key IN ('operations.checkOut','ops.check_out')`);
  const stdOut = set.find(s => s.key === 'operations.checkOut')?.value ?? set.find(s => s.key === 'ops.check_out')?.value ?? '11:00';
  const out = await cleaningCheckoutSql(env, 'r');
  const time = `COALESCE(NULLIF(${out.time}, ''), ?)`;
  return all<DueDeparture>(env, `
    SELECT r.id, r.unit_id, r.state, r.check_out, r.check_out_time, ${time} AS out_at, ${out.requested} OR COALESCE(r.check_out_time, ?) > ? AS late, c.id AS task_id
    FROM reservations r
    LEFT JOIN LATERAL (
      SELECT t.id, t.state, t.guest_left_at FROM tasks t
      WHERE t.kind IN ${CLEAN_KINDS_SQL} AND (t.reservation_id = r.id OR (t.unit_id = r.unit_id AND ${DAY} = r.check_out))
      ORDER BY (t.reservation_id = r.id) DESC LIMIT 1
    ) c ON TRUE
    WHERE r.check_out = ? AND ${LIVE_STAY_SQL('r')} AND r.state <> 'checked_out'
      AND ${time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${time} <= ?
      AND (c.id IS NULL OR (c.guest_left_at IS NULL AND c.state <> 'resolved'
        AND NOT EXISTS (SELECT 1 FROM audit_log l WHERE l.entity_table = 'tasks' AND l.entity_id = c.id AND l.action = 'task.guest_left_undo')))
      AND (c.id IS NOT NULL OR (r.channel <> 'owner_stay'
        AND NOT EXISTS (SELECT 1 FROM audit_log l WHERE l.entity_table = 'reservations' AND l.entity_id = r.id AND l.action = 'cleaning.cancel')))
    ORDER BY ${time}, r.id LIMIT ${Math.max(1, Math.floor(limit))}`,
    stdOut, stdOut, stdOut, today, stdOut, stdOut, nowHm, stdOut);
}
