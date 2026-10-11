import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { findClash, clashResponseBody, nextBookingRef, holdOnChannels, withUnitLock } from '../../../_lib/reservations';

/** POST /api/reservations/:id/duplicate — a pending copy placed straight after the original. The copy is ours, so
 *  it gets our own reference, and its nights are closed on the booking sites like any booking made here. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot create reservations.', 403);

  const src = await one<any>(env, 'SELECT * FROM reservations WHERE id = ?', String(params.id));
  if (!src) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const nights = Math.max(1, Math.round((Date.parse(src.check_out) - Date.parse(src.check_in)) / 864e5));
  const checkIn = src.check_out;
  const checkOut = new Date(Date.parse(checkIn) + nights * 864e5).toISOString().slice(0, 10);
  const id = crypto.randomUUID(), now = nowIso();
  // A copy made here is not on the booking site the original came from, so it is a direct booking.
  const channel = ['direct', 'owner_stay'].includes(src.channel) ? src.channel : 'direct';
  // A direct copy keeps the price breakdown (cleaning fee, other fees, room charges), so the money panel still adds up.
  const extra = channel === src.channel ? ['guest_cleaning_fee', 'extra_fees', 'room_revenue'].filter(c => c in src && src[c] != null) : [];
  const saved = await withUnitLock(env, src.unit_id, async tx => {
    const clash = await findClash(tx, src.unit_id, checkIn, checkOut, null);
    if (clash) return { clash, ref: '' };
    const ref = await nextBookingRef(tx, id);
    await run(tx, `
      INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, check_in_time, check_out_time, guests_count, gross_booking_value, currency, created_at, updated_at${extra.map(c => `, ${c}`).join('')})
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?${extra.map(() => ', ?').join('')})`,
      id, src.unit_id, src.guest_id, channel, ref, checkIn, checkOut,
      src.check_in_time, src.check_out_time, src.guests_count, src.gross_booking_value, src.currency, now, now, ...extra.map(c => src[c]));
    return { clash: null, ref };
  });
  if (saved.clash) return json(clashResponseBody(saved.clash), 409);
  const ref = saved.ref;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.duplicate', entityTable: 'reservations', entityId: id, after: { copiedFrom: src.id } });
  const sync = await holdOnChannels(env, src.unit_id, checkIn, checkOut, false, id);
  return json({ id, externalRef: ref, checkIn, checkOut, channel, effects: { channel: sync } }, 201);
};
