import { type Env, one, run, audit } from './db';
import type { Session } from './auth';

/** The reservation that already holds any of these nights on the unit, or null.
 *  Check-out day is free. Cancelled, no-show and inquiry rows do not hold dates. */
export async function findClash(env: Env, unitId: string, checkIn: string, checkOut: string, exceptId: string | null) {
  return one<{ id: string; check_in: string; check_out: string; guest_name: string }>(env, `
    SELECT r.id, r.check_in, r.check_out, COALESCE(NULLIF(g.full_name, ''), 'a block') AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.unit_id = ? AND r.state NOT IN ('cancelled','no_show','inquiry')
      AND r.check_in < ? AND r.check_out > ? AND r.id != ?
    LIMIT 1`, unitId, checkOut, checkIn, exceptId ?? '');
}

export function clashResponseBody(c: NonNullable<Awaited<ReturnType<typeof findClash>>>) {
  return {
    error: { code: 'DATE_CONFLICT', message: `Blocked. This unit already has ${c.guest_name} on those dates.` },
    conflict: { reservationId: c.id, guestName: c.guest_name, checkIn: c.check_in, checkOut: c.check_out },
  };
}

/** Reuses a guest with the same email (or phone), otherwise creates one. Returns the guest id. */
export async function upsertGuest(env: Env, g: { fullName: string; email?: string | null; phone?: string | null }): Promise<string> {
  const email = g.email?.trim() || null, phone = g.phone?.trim() || null;
  const found = email
    ? await one<{ id: string }>(env, 'SELECT id FROM guests WHERE lower(email) = lower(?) LIMIT 1', email)
    : phone ? await one<{ id: string }>(env, 'SELECT id FROM guests WHERE phone = ? LIMIT 1', phone) : null;
  if (found) return found.id;
  const id = crypto.randomUUID();
  await run(env, 'INSERT INTO guests (id, full_name, email, phone, created_at) VALUES (?, ?, ?, ?, ?)', id, g.fullName.trim(), email, phone, new Date().toISOString());
  return id;
}

/** Readiness a unit moves to when a stay changes state. */
export async function applyStayState(env: Env, session: Session, reservationId: string, unitId: string, state: string) {
  const readiness = state === 'checked_in' ? 'occupied' : state === 'checked_out' ? 'dirty' : null;
  const now = new Date().toISOString();
  if (readiness) await run(env, 'UPDATE units SET readiness = ?, updated_at = ? WHERE id = ?', readiness, now, unitId);
  if (state === 'checked_out') {
    const open = await one(env, `SELECT 1 AS x FROM tasks WHERE reservation_id = ? AND state != 'resolved'`, reservationId);
    if (!open) {
      await run(env, `
        INSERT INTO tasks (id, unit_id, reservation_id, kind, state, title, due_at, requires_photo, created_at, updated_at)
        VALUES (?, ?, ?, 'turnover', 'open', 'Turnover after check-out', ?, 1, ?, ?)`,
        crypto.randomUUID(), unitId, reservationId, now, now, now);
    }
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `reservation.${state}`, entityTable: 'reservations', entityId: reservationId, after: { state } });
}
