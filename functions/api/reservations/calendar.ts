import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

const LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda',
  direct: 'Direct', maintenance_block: 'Block', owner_stay: 'Owner stay',
};
const STATE_LABEL: Record<string, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in',
  checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
};

/** GET /api/reservations/calendar?from=&to= — units, bookings and blocks over the window, plus rates. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'The calendar is not available to field roles.', 403);

  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? from;

  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.base_rate, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id
    ORDER BY p.name, u.unit_number`);

  const blocks = await all<any>(env, `
    SELECT r.id, r.unit_id, r.channel, r.state, r.check_in, r.check_out, r.gross_booking_value,
           r.external_ref, r.notes, COALESCE(g.full_name, '') AS guest_name
    FROM reservations r
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.check_out > ? AND r.check_in < ? AND r.state != 'cancelled'
    ORDER BY r.check_in`, from, to);

  const rates = await all<any>(env, `SELECT unit_id, channel, rate_date, rate FROM channel_rates WHERE rate_date >= ? AND rate_date <= ?`, from, to);

  return json({
    from, to,
    generatedAt: new Date().toISOString(),
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, propertyName: u.property_name })),
    baseRate: Object.fromEntries(units.map(u => [u.id, Number(u.base_rate)])),
    // Nights priced by hand, keyed "unitId:channel:date" (channel 'web' is the direct rate).
    rates: Object.fromEntries(rates.map(r => [`${r.unit_id}:${r.channel}:${r.rate_date}`, Number(r.rate)])),
    // label is server-provided so channel and status never depend on colour.
    blocks: blocks.map(b => ({
      id: b.id, unitId: b.unit_id, channel: b.channel, state: b.state,
      guestName: b.guest_name || (b.channel === 'maintenance_block' ? (b.notes ?? 'Blocked') : ''),
      checkIn: b.check_in, checkOut: b.check_out,
      grossBookingValue: Number(b.gross_booking_value), ref: b.external_ref,
      reason: b.notes,
      label: `${LABEL[b.channel]}${STATE_LABEL[b.state] ? ' · ' + STATE_LABEL[b.state] : ''}`,
    })),
  });
};
