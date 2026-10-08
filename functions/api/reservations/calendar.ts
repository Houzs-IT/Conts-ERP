import { WEEKEND_MULTIPLIER, OTA_CHANNELS, upliftFor } from '../../_lib/channelPrice';
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

/** A unit counts as on a booking site if it had a booking from it within this many days. */
const CHANNEL_LOOKBACK_DAYS = 180;

/** GET /api/reservations/calendar?from=&to= — units, bookings and blocks over the window, plus rates. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'The calendar is not available to field roles.', 403);

  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? from;

  const [units, onChannel] = await Promise.all([
    all<any>(env, `
      SELECT u.id, u.unit_number, u.base_rate, p.name AS property_name
      FROM units u JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.unit_number`),
    // Which booking sites each unit is on, so the board shows a rate row only for those. A connection made
    // through Channex (channex_channels: written on connect, removed on disconnect) is the truth; the
    // per-OTA rate plans on units are created for all three sites at once, and unit_channels is never
    // written by the app, so neither says where a unit is listed. A unit with a booking from a site in the
    // last 180 days (or a future one) also counts: units imported from HostPlatform have bookings but no
    // Channex connection yet.
    all<{ unit_id: string; channel: string }>(env, `
      SELECT unit_id, ota AS channel FROM channex_channels
      UNION
      SELECT unit_id, channel FROM reservations
      WHERE channel IN ('airbnb','booking_com','agoda') AND check_out >= ?`,
      new Date(Date.now() - CHANNEL_LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10)),
  ]);
  const channelsOf = (unitId: string) => OTA_CHANNELS.filter(ch => onChannel.some(r => r.unit_id === unitId && r.channel === ch));

  const blocks = await all<any>(env, `
    SELECT r.id, r.unit_id, r.channel, r.state, r.check_in, r.check_out, r.gross_booking_value,
           r.external_ref, r.notes, COALESCE(g.full_name, '') AS guest_name
    FROM reservations r
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.check_out > ? AND r.check_in < ? AND r.state != 'cancelled'
    ORDER BY r.check_in`, from, to);

  const rates = await all<any>(env, `SELECT unit_id, channel, rate_date, rate FROM channel_rates WHERE rate_date >= ? AND rate_date <= ?`, from, to);
  const uplifts = await all<any>(env, 'SELECT unit_id, channel, uplift FROM channel_uplifts');
  const restr = await all<any>(env, `SELECT unit_id, rate_date, min_stay, stop_sell FROM unit_restrictions WHERE rate_date >= ? AND rate_date <= ? AND (min_stay > 1 OR stop_sell)`, from, to);

  return json({
    from, to,
    generatedAt: new Date().toISOString(),
    // channels: the booking sites the unit is on, in a fixed order. The direct (web) rate is always shown.
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, propertyName: u.property_name, channels: channelsOf(u.id) })),
    baseRate: Object.fromEntries(units.map(u => [u.id, Number(u.base_rate)])),
    // What a night costs on a channel when it has no price of its own: (base + that channel's uplift), times
    // the weekend multiplier on Friday and Saturday. Same rule as the Pricing page and Channex (channelPrice.ts).
    uplifts: Object.fromEntries(units.flatMap(u => OTA_CHANNELS.map(ch => [`${u.id}:${ch}`, upliftFor(ch, Number(u.base_rate), uplifts.find(x => x.unit_id === u.id && x.channel === ch)?.uplift)]))),
    weekendMultiplier: WEEKEND_MULTIPLIER,
    // Nights priced by hand, keyed "unitId:channel:date" (channel 'web' is the direct rate).
    rates: Object.fromEntries(rates.map(r => [`${r.unit_id}:${r.channel}:${r.rate_date}`, Number(r.rate)])),
    // Nights with a minimum stay above one or closed for sale, keyed "unitId:date".
    restrictions: Object.fromEntries(restr.map(r => [`${r.unit_id}:${r.rate_date}`, { minStay: r.min_stay ?? 1, stopSell: !!r.stop_sell }])),
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
