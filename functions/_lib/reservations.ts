import { type Env, one, run, audit } from './db';
import { syncAvailabilityIfLinked, channexMappingFor } from './channexSync';
import { channexConfigured } from './channex';

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

/** Our own reference for a booking made here: TC-YYMM-####, numbered per month (Kuala Lumpur time) from a
 *  counter row, so two bookings made at the same moment never share a number. Bookings from a booking site
 *  keep the site's reference. Before migration 0091 the counter does not exist and the old MAN- form is used. */
export async function nextBookingRef(env: Env, fallbackId: string): Promise<string> {
  const yymm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(2, 7).replace('-', '');
  try {
    const r = await one<{ last: number }>(env, `
      INSERT INTO booking_ref_counters (month, last)
      VALUES (?, COALESCE((SELECT MAX(substring(external_ref from 9)::int) FROM reservations WHERE external_ref ~ ('^TC-' || ? || '-[0-9]{4,}$')), 0) + 1)
      ON CONFLICT (month) DO UPDATE SET last = booking_ref_counters.last + 1
      RETURNING last`, yymm, yymm);
    return `TC-${yymm}-${String(r!.last).padStart(4, '0')}`;
  } catch {
    return `MAN-${fallbackId.slice(0, 6).toUpperCase()}`;
  }
}

/** Closes (or reopens) the nights on every booking site the unit is sold on. A Channex failure never fails the
 *  booking that was already saved here: it is reported back as 'failed' and written to the audit log. */
export async function holdOnChannels(env: Env, unitId: string, checkIn: string, checkOut: string, release: boolean, reservationId: string): Promise<'queued' | 'not_linked' | 'failed'> {
  try {
    if (!channexConfigured(env) || !(await channexMappingFor(env, unitId))) return 'not_linked';
    await syncAvailabilityIfLinked(env, unitId, checkIn, checkOut, release);
    return 'queued';
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.availability_failed', entityTable: 'reservations', entityId: reservationId,
      after: { unitId, checkIn, checkOut, release, error: e instanceof Error ? e.message.slice(0, 300) : String(e) } }).catch(() => {});
    return 'failed';
  }
}
