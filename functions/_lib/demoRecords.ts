import { type Env, one, run, all, fail, nowIso } from './db';
import { checkSen, checkInt, checkDate, invalid, type Fields } from './validate';
import { newDemoId } from './demo';

/** Sample reservations and reviews (Demo mode, migration 0199). Every write here goes to schema demo: a new sample
 *  row, or for a real record the demo shadow that stands in for it in Demo mode (demo.shadow). Nothing here writes
 *  to pos; the database rule (pos.refuse_demo_ids) would refuse it if it tried. */

export const DEMO_CHANNELS = ['airbnb', 'booking_com', 'agoda', 'direct'] as const;
const STATES = ['confirmed', 'checked_in', 'checked_out', 'cancelled'] as const;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export interface ReservationInput {
  unitId?: unknown; guestName?: unknown; channel?: unknown; checkIn?: unknown; checkOut?: unknown;
  guestsCount?: unknown; grossBookingValue?: unknown; state?: unknown; notes?: unknown;
}

/** Checks a sample reservation; on create every field that makes a stay is required. */
export async function checkReservation(env: Env, b: ReservationInput, create: boolean): Promise<Response | null> {
  const f: Fields = {};
  if (create || b.unitId !== undefined) {
    if (typeof b.unitId !== 'string' || !b.unitId) f.unitId = 'Pick a unit.';
    else if (!(await one(env, 'SELECT 1 AS x FROM demo.v_units WHERE id = ?', b.unitId))) f.unitId = 'That unit does not exist.';
  }
  if ((create || b.guestName !== undefined) && !text(b.guestName, 120)) f.guestName = 'Enter the guest\'s name.';
  if ((create || b.channel !== undefined) && !(DEMO_CHANNELS as readonly unknown[]).includes(b.channel)) f.channel = 'Pick a channel.';
  checkDate(f, 'checkIn', b.checkIn, { label: 'Check-in', required: create });
  checkDate(f, 'checkOut', b.checkOut, { label: 'Checkout', required: create });
  if (typeof b.checkIn === 'string' && typeof b.checkOut === 'string' && !f.checkIn && !f.checkOut && b.checkOut <= b.checkIn) f.checkOut = 'Checkout must be after check-in.';
  checkInt(f, 'guestsCount', b.guestsCount, { label: 'Guests', required: create, min: 1, max: 30 });
  checkSen(f, 'grossBookingValue', b.grossBookingValue, { label: 'Gross', required: create, max: 100_000_00 });
  if (b.state !== undefined && !(STATES as readonly unknown[]).includes(b.state)) f.state = 'Pick a status.';
  return invalid(f);
}

/** A stay that would overlap another live stay on the same unit, real or sample (Demo mode's calendar must still
 *  read as a real calendar). `except` is the reservation being edited. */
async function clash(env: Env, unitId: string, checkIn: string, checkOut: string, except?: string) {
  return one<{ id: string }>(env, `SELECT id FROM demo.v_reservations WHERE unit_id = ? AND check_in < ? AND check_out > ?
    AND state NOT IN ('cancelled', 'no_show') AND id <> ? LIMIT 1`, unitId, checkOut, checkIn, except ?? '');
}

export async function createReservation(env: Env, b: ReservationInput, actor: string): Promise<Response | { id: string }> {
  const bad = await checkReservation(env, b, true);
  if (bad) return bad;
  const unitId = b.unitId as string, checkIn = b.checkIn as string, checkOut = b.checkOut as string;
  if (await clash(env, unitId, checkIn, checkOut)) return fail('DATE_CONFLICT', 'That unit already has a reservation on some of these nights.', 409, { checkIn: 'Overlaps another reservation.' });
  const at = nowIso(), id = newDemoId('r'), guestId = newDemoId('g');
  await run(env, 'INSERT INTO demo.guests (id, full_name, created_at, demo_by, demo_at) VALUES (?, ?, ?, ?, ?)', guestId, text(b.guestName, 120), at, actor, at);
  await run(env, `INSERT INTO demo.reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count,
      gross_booking_value, collected_revenue, notes, created_at, updated_at, demo_by, demo_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, unitId, guestId, b.channel, `DEMO-${id.slice(-6).toUpperCase()}`, (b.state as string) ?? 'confirmed', checkIn, checkOut,
    b.guestsCount, b.grossBookingValue, b.grossBookingValue, text(b.notes, 2000), at, at, actor, at);
  return { id };
}

/** The demo row to change for a reservation or review id: the sample row itself, or the real record's shadow
 *  (made on the first change). */
async function demoRowFor(env: Env, table: 'reservations' | 'reviews', id: string, actor: string): Promise<string | Response> {
  if (id.startsWith('demo-')) {
    const own = await one<{ id: string }>(env, `SELECT id FROM demo.${table} WHERE id = ?`, id);
    return own ? own.id : fail('NOT_FOUND', 'That sample record no longer exists.', 404);
  }
  if (!(await one(env, `SELECT 1 AS x FROM ${table} WHERE id = ?`, id))) return fail('NOT_FOUND', 'That record does not exist.', 404);
  const r = await one<{ id: string }>(env, 'SELECT demo.shadow(?, ?, ?) AS id', table, id, actor);
  return r!.id;
}

export async function updateReservation(env: Env, id: string, b: ReservationInput, actor: string): Promise<Response | { id: string; shadow: boolean }> {
  const bad = await checkReservation(env, b, false);
  if (bad) return bad;
  const current = await one<any>(env, 'SELECT id, unit_id, guest_id, check_in, check_out FROM demo.v_reservations WHERE id = ?', id);
  if (!current) return fail('NOT_FOUND', 'That reservation does not exist.', 404);
  const unitId = (b.unitId as string) ?? current.unit_id, checkIn = (b.checkIn as string) ?? current.check_in, checkOut = (b.checkOut as string) ?? current.check_out;
  if (checkOut <= checkIn) return fail('VALIDATION', 'Checkout must be after check-in.', 422, { checkOut: 'Checkout must be after check-in.' });
  if (await clash(env, unitId, checkIn, checkOut, id)) return fail('DATE_CONFLICT', 'That unit already has a reservation on some of these nights.', 409, { checkIn: 'Overlaps another reservation.' });
  const row = await demoRowFor(env, 'reservations', id, actor);
  if (row instanceof Response) return row;
  const at = nowIso();
  const name = text(b.guestName, 120);
  if (name) {
    // The guest's name in Demo mode only: a sample guest is changed, a real guest gets a shadow, none gets a sample guest.
    const gid = current.guest_id as string | null;
    const guest = gid ? (gid.startsWith('demo-') ? gid : (await one<{ id: string }>(env, 'SELECT demo.shadow(?, ?, ?) AS id', 'guests', gid, actor))!.id) : null;
    if (guest) await run(env, 'UPDATE demo.guests SET full_name = ? WHERE id = ?', name, guest);
    else {
      const ng = newDemoId('g');
      await run(env, 'INSERT INTO demo.guests (id, full_name, created_at, demo_by, demo_at) VALUES (?, ?, ?, ?, ?)', ng, name, at, actor, at);
      await run(env, 'UPDATE demo.reservations SET guest_id = ? WHERE id = ?', ng, row);
    }
  }
  const sets: string[] = [], args: unknown[] = [];
  const put = (col: string, v: unknown) => { if (v !== undefined) { sets.push(`${col} = ?`); args.push(v); } };
  put('unit_id', b.unitId); put('channel', b.channel); put('check_in', b.checkIn); put('check_out', b.checkOut);
  put('guests_count', b.guestsCount); put('gross_booking_value', b.grossBookingValue); put('state', b.state);
  if (b.notes !== undefined) put('notes', text(b.notes, 2000));
  await run(env, `UPDATE demo.reservations SET ${[...sets, 'updated_at = ?', 'demo_by = ?', 'demo_at = ?'].join(', ')} WHERE id = ?`, ...args, at, actor, at, row);
  return { id, shadow: !id.startsWith('demo-') };
}

export interface ReviewInput { unitId?: unknown; reservationId?: unknown; channel?: unknown; rating?: unknown; comment?: unknown; reply?: unknown; reviewedAt?: unknown }

export async function checkReview(env: Env, b: ReviewInput, create: boolean): Promise<Response | null> {
  const f: Fields = {};
  if (create || b.unitId !== undefined) {
    if (typeof b.unitId !== 'string' || !b.unitId) f.unitId = 'Pick a unit.';
    else if (!(await one(env, 'SELECT 1 AS x FROM demo.v_units WHERE id = ?', b.unitId))) f.unitId = 'That unit does not exist.';
  }
  if (b.reservationId != null && b.reservationId !== '' && !(await one(env, 'SELECT 1 AS x FROM demo.v_reservations WHERE id = ?', b.reservationId))) f.reservationId = 'That reservation does not exist.';
  if ((create || b.channel !== undefined) && !(DEMO_CHANNELS as readonly unknown[]).includes(b.channel)) f.channel = 'Pick a channel.';
  checkInt(f, 'rating', b.rating, { label: 'Rating', required: create, min: 1, max: 5 });
  checkDate(f, 'reviewedAt', b.reviewedAt, { label: 'Review date', required: create });
  return invalid(f);
}

export async function createReview(env: Env, b: ReviewInput, actor: string): Promise<Response | { id: string }> {
  const bad = await checkReview(env, b, true);
  if (bad) return bad;
  const at = nowIso(), id = newDemoId('v');
  const reply = text(b.reply, 2000);
  await run(env, `INSERT INTO demo.reviews (id, unit_id, reservation_id, channel, rating, comment, reviewed_at, reply, replied_at, demo_by, demo_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.unitId, b.reservationId || null, b.channel, b.rating, text(b.comment, 2000), b.reviewedAt, reply, reply ? at : null, actor, at);
  return { id };
}

export async function updateReview(env: Env, id: string, b: ReviewInput, actor: string): Promise<Response | { id: string; shadow: boolean }> {
  const bad = await checkReview(env, b, false);
  if (bad) return bad;
  const row = await demoRowFor(env, 'reviews', id, actor);
  if (row instanceof Response) return row;
  const at = nowIso();
  const sets: string[] = [], args: unknown[] = [];
  const put = (col: string, v: unknown) => { if (v !== undefined) { sets.push(`${col} = ?`); args.push(v); } };
  put('unit_id', b.unitId); put('channel', b.channel); put('rating', b.rating); put('reviewed_at', b.reviewedAt);
  if (b.reservationId !== undefined) put('reservation_id', b.reservationId || null);
  if (b.comment !== undefined) put('comment', text(b.comment, 2000));
  if (b.reply !== undefined) { const r = text(b.reply, 2000); put('reply', r); put('replied_at', r ? at : null); }
  await run(env, `UPDATE demo.reviews SET ${[...sets, 'demo_by = ?', 'demo_at = ?'].join(', ')} WHERE id = ?`, ...args, actor, at, row);
  return { id, shadow: !id.startsWith('demo-') };
}

/** Removes a sample row, or a real record's shadow (so Demo mode shows the real record again). */
export async function removeDemo(env: Env, table: 'reservations' | 'reviews', id: string): Promise<Response | { removed: string }> {
  const row = await one<{ id: string; guest_id?: string | null }>(env, `SELECT id${table === 'reservations' ? ', guest_id' : ''} FROM demo.${table} WHERE id = ? OR shadow_of = ?`, id, id);
  if (!row) return fail('NOT_FOUND', id.startsWith('demo-') ? 'That sample record no longer exists.' : 'This record has no sample changes.', 404);
  await run(env, `DELETE FROM demo.${table} WHERE id = ?`, row.id);
  // A sample reservation's own sample guest goes with it.
  if (table === 'reservations' && row.guest_id?.startsWith('demo-g-') && id.startsWith('demo-')) {
    const others = await all(env, 'SELECT 1 AS x FROM demo.reservations WHERE guest_id = ? LIMIT 1', row.guest_id);
    if (!others.length) await run(env, 'DELETE FROM demo.guests WHERE id = ?', row.guest_id);
  }
  return { removed: row.id };
}

export async function demoCounts(env: Env) {
  const r = await one<Record<string, number>>(env, `SELECT
    (SELECT count(*)::int FROM demo.reservations WHERE shadow_of IS NULL) AS reservations,
    (SELECT count(*)::int FROM demo.reviews WHERE shadow_of IS NULL) AS reviews,
    (SELECT count(*)::int FROM demo.units WHERE shadow_of IS NULL) AS units,
    (SELECT count(*)::int FROM demo.owners WHERE shadow_of IS NULL) AS owners,
    ((SELECT count(*) FROM demo.reservations WHERE shadow_of IS NOT NULL) + (SELECT count(*) FROM demo.reviews WHERE shadow_of IS NOT NULL)
      + (SELECT count(*) FROM demo.units WHERE shadow_of IS NOT NULL) + (SELECT count(*) FROM demo.guests WHERE shadow_of IS NOT NULL))::int AS shadows`);
  return { reservations: r?.reservations ?? 0, reviews: r?.reviews ?? 0, units: r?.units ?? 0, owners: r?.owners ?? 0, shadows: r?.shadows ?? 0 };
}
