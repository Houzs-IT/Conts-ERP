import { type Env, one, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { findClash, clashResponseBody, withUnitLock } from '../../../_lib/reservations';
import { syncAvailabilityIfLinked, channexMappingFor } from '../../../_lib/channexSync';
import { channexConfigured } from '../../../_lib/channex';
import { dayLabel } from '../../../_lib/bookingLifecycle';
import { checkSen, checkDate, invalid, type Fields } from '../../../_lib/validate';
import { bookingNotice } from '../../../_lib/notices';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** States whose dates can still move. A finished, cancelled or no-show stay is history. */
const MOVABLE = ['inquiry', 'pending', 'confirmed', 'checked_in'];

/** PATCH /api/reservations/:id/dates { checkIn, checkOut, confirm, grossBookingValue? } — without confirm: 428 with the
 *  consequence. A direct booking or a block may carry a new total; a booking site's price is the site's, so it is left alone.
 *  Nobody is messaged: the answer says only what was saved and whether the channels were updated. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change reservations.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (!b?.checkIn || !b.checkOut || !ISO_DAY.test(b.checkIn) || !ISO_DAY.test(b.checkOut)) return fail('VALIDATION', 'Both dates are required.', 422);
  const fields: Fields = {};
  checkDate(fields, 'checkIn', b.checkIn, { label: 'Check-in', required: true });
  checkDate(fields, 'checkOut', b.checkOut, { label: 'Checkout', required: true });
  checkSen(fields, 'grossBookingValue', b.grossBookingValue, { label: 'Guest total' });
  const bad = invalid(fields); if (bad) return bad;
  if (b.checkOut <= b.checkIn) return fail('VALIDATION', 'Checkout must be after check-in.', 422, { checkOut: 'Checkout must be after check-in.' });

  const cur = await one<any>(env, `
    SELECT r.id, r.unit_id, r.state, r.channel, r.check_in, r.check_out, r.gross_booking_value, COALESCE(NULLIF(g.full_name, ''), 'The booking') AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id WHERE r.id = ?`, id);
  if (!cur) return fail('NOT_FOUND', 'That reservation does not exist.', 404);
  if (!MOVABLE.includes(cur.state)) return fail('CONFLICT', 'The dates of a past, cancelled or no-show reservation cannot change.', 409);
  // A booking site owns its bookings' dates (drag on the calendar included): changed here, the site would still
  // hold the old nights and sell the new ones to someone else.
  if (['airbnb', 'booking_com', 'agoda'].includes(cur.channel)) {
    const site = cur.channel === 'airbnb' ? 'Airbnb' : cur.channel === 'booking_com' ? 'Booking.com' : 'Agoda';
    return fail('OTA_LOCKED', `This is a ${site} reservation: its dates are set on ${site}. Change them there; the change comes back here by itself.`, 409);
  }
  if (cur.state === 'checked_in' && b.checkIn !== cur.check_in) return fail('CONFLICT', 'The guest is already in. Only the checkout date can change.', 409);

  let gross: number | null = null;
  if (b.grossBookingValue != null) {
    if (['airbnb', 'booking_com', 'agoda'].includes(cur.channel)) return fail('VALIDATION', 'A channel sets its own price. Change it on the channel.', 422);
    gross = Math.round(Number(b.grossBookingValue));
    if (!Number.isFinite(gross) || gross < 0) return fail('VALIDATION', 'The guest total must be zero or more.', 422, { grossBookingValue: 'Enter an amount.' });
  }

  const clash = await findClash(env, cur.unit_id, b.checkIn, b.checkOut, id);
  if (clash) return json(clashResponseBody(clash), 409);

  if (!b.confirm) {
    return fail('CONFIRMATION_REQUIRED', `${cur.guest_name} moves from ${dayLabel(cur.check_in)} – ${dayLabel(cur.check_out)} to ${dayLabel(b.checkIn)} – ${dayLabel(b.checkOut)}. Confirm to continue.`, 428);
  }

  const now = nowIso();
  // Checked again under the unit's lock, and written only if the booking is still as it was read above.
  const saved = await withUnitLock(env, cur.unit_id, async tx => {
    const again = await findClash(tx, cur.unit_id, b.checkIn, b.checkOut, id);
    if (again) return { clash: again, moved: false };
    const row = await one(tx, 'UPDATE reservations SET check_in = ?, check_out = ?, gross_booking_value = COALESCE(?, gross_booking_value), updated_at = ? WHERE id = ? AND state = ? AND check_in = ? AND check_out = ? RETURNING id',
      b.checkIn, b.checkOut, gross, now, id, cur.state, cur.check_in, cur.check_out);
    return { clash: null, moved: !!row };
  });
  if (saved.clash) return json(clashResponseBody(saved.clash), 409);
  if (!saved.moved) return fail('CONFLICT', 'This reservation changed while you were looking at it. Refresh and try again.', 409);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'reservation.dates', entityTable: 'reservations', entityId: id,
    before: { checkIn: cur.check_in, checkOut: cur.check_out, ...(gross != null ? { grossBookingValue: Number(cur.gross_booking_value) } : {}) },
    after: { checkIn: b.checkIn, checkOut: b.checkOut, ...(gross != null ? { grossBookingValue: gross } : {}) },
  });
  if (cur.state !== 'inquiry') await bookingNotice(env, id, 'dates', session.userId, { from: { checkIn: cur.check_in, checkOut: cur.check_out } });

  // A live stay holds its nights on the channels; an inquiry does not hold dates, so there is nothing to move.
  let channel: 'queued' | 'not_linked' | 'failed' | null = null;
  if (cur.state !== 'inquiry') {
    try {
      if (!channexConfigured(env) || !(await channexMappingFor(env, cur.unit_id))) channel = 'not_linked';
      else {
        await syncAvailabilityIfLinked(env, cur.unit_id, cur.check_in, cur.check_out, true);
        await syncAvailabilityIfLinked(env, cur.unit_id, b.checkIn, b.checkOut, false);
        channel = 'queued';
      }
    } catch { channel = 'failed'; }
  }
  return json({ id, checkIn: b.checkIn, checkOut: b.checkOut, grossBookingValue: gross ?? Number(cur.gross_booking_value), effects: { channel } });
};
