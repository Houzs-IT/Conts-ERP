import { OTA_CHANNELS, upliftFor, defaultUpliftShare } from '../../_lib/channelPrice';
import { type Env, all, json, fail } from '../../_lib/db';
import { rentalOnly } from '../../_lib/unitPurpose';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { accessFor, canManage, refusalFor } from '../../_lib/access';

/** A unit counts as on a booking site if it had a booking from it within this many days. */
const CHANNEL_LOOKBACK_DAYS = 180;

const MAX_CALENDAR_DAYS = 92;

/** GET /api/reservations/calendar?from=&to=[&property=] — units, bookings and blocks over the window, plus rates.
 *  With `property` (a building id) only that building's units come back; `buildings` always lists every
 *  building with its unit count, for the building filter. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'The calendar is not available to cleaners and technicians.', 403);

  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? from;
  const property = url.searchParams.get('property') || null;
  // The board shows 30 nights. A window is capped so one request cannot pull every booking and rate of every unit
  // for years (a year was 1.35 MB and 8 queries over the whole table; at Workers' limits that is the 503 Houzs hit).
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(from) || !ymd.test(to) || to < from) return fail('VALIDATION', 'Pick a start and end date, the end on or after the start.', 422);
  if ((Date.parse(to) - Date.parse(from)) / 864e5 + 1 > MAX_CALENDAR_DAYS) return fail('VALIDATION', `Show at most ${MAX_CALENDAR_DAYS} days at a time.`, 422);

  // Showroom and warehouse units take no reservations (0125).
  const rental = await rentalOnly(env);
  const [allUnits, onChannel, connected] = await Promise.all([
    all<any>(env, `
      SELECT u.id, u.unit_number, u.base_rate, u.weekend_rate, u.property_id, p.name AS property_name
      FROM units u JOIN properties p ON p.id = u.property_id
      WHERE 1 = 1${rental}
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
    // The booking sites the unit is actually connected to: only these get a price sent, so only these show one.
    all<{ unit_id: string; ota: string }>(env, 'SELECT unit_id, ota FROM channex_channels'),
  ]);
  const connectedSet = new Set(connected.map(r => `${r.unit_id}:${r.ota}`));
  const onChannelSet = new Set(onChannel.map(r => `${r.unit_id}:${r.channel}`));
  const channelsOf = (unitId: string) => OTA_CHANNELS.filter(ch => onChannelSet.has(`${unitId}:${ch}`));

  const buildingMap = new Map<string, { id: string; name: string; units: number }>();
  for (const u of allUnits) {
    const b = buildingMap.get(u.property_id) ?? { id: u.property_id, name: u.property_name, units: 0 };
    b.units++; buildingMap.set(u.property_id, b);
  }
  const units = property ? allUnits.filter(u => u.property_id === property) : allUnits;
  const scoped = (col: string) => (property ? ` AND ${col} IN (SELECT id FROM units WHERE property_id = ?)` : '');
  const scopeArgs = property ? [property] : [];

  const blocks = await all<any>(env, `
    SELECT r.id, r.unit_id, r.channel, r.state, r.check_in, r.check_out, r.gross_booking_value,
           r.external_ref, r.notes, r.block_reason, COALESCE(g.full_name, '') AS guest_name
    FROM reservations r
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.check_out > ? AND r.check_in < ? AND r.state NOT IN ('cancelled', 'no_show')${scoped('r.unit_id')}
    ORDER BY r.check_in`, from, to, ...scopeArgs);

  const [rates, uplifts, restr] = await Promise.all([
    all<any>(env, `SELECT unit_id, channel, rate_date, rate FROM channel_rates WHERE rate_date >= ? AND rate_date <= ?${scoped('unit_id')}`, from, to, ...scopeArgs),
    all<any>(env, `SELECT unit_id, channel, uplift FROM channel_uplifts WHERE true${scoped('unit_id')}`, ...scopeArgs),
    all<any>(env, `SELECT unit_id, rate_date, min_stay, stop_sell FROM unit_restrictions WHERE rate_date >= ? AND rate_date <= ? AND (min_stay > 1 OR stop_sell)${scoped('unit_id')}`, from, to, ...scopeArgs),
  ]);
  const upliftOf = new Map(uplifts.map(x => [`${x.unit_id}:${x.channel}`, x.uplift]));
  // Whether this person may change prices: the same rule PUT /rates and POST /rates/bulk apply, so the board can
  // hide Change price and Rate update instead of offering a button that answers 403.
  const ratesAccess = await accessFor(env, session.role, '/api/rates', 'GET', session.side);
  const canSetRates = (canManage(session.role, ratesAccess) || session.role === 'operations_manager') && !refusalFor(ratesAccess, 'POST');
  const weekendOf = (u: any) => (u.weekend_rate == null ? null : Number(u.weekend_rate));

  return json({
    from, to, property,
    generatedAt: new Date().toISOString(),
    // channels: the booking sites the unit is on, in a fixed order. The direct (web) rate is always shown.
    buildings: [...buildingMap.values()],
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, propertyId: u.property_id, propertyName: u.property_name, channels: channelsOf(u.id), linked: OTA_CHANNELS.filter(ch => connectedSet.has(`${u.id}:${ch}`)) })),
    baseRate: Object.fromEntries(units.map(u => [u.id, Number(u.base_rate)])),
    // What a night costs on a channel when it has no price of its own: the night's web price (weekendRate on
    // Friday and Saturday when the unit has one, else baseRate) plus that channel's uplift. A default uplift is a
    // share of the web price, so weekend nights carry their own (weekendUplifts). Same rule as the Pricing page
    // and Channex (channelPrice.ts).
    weekendRate: Object.fromEntries(units.map(u => [u.id, weekendOf(u)])),
    uplifts: Object.fromEntries(units.flatMap(u => OTA_CHANNELS.map(ch => [`${u.id}:${ch}`, upliftFor(ch, Number(u.base_rate), upliftOf.get(`${u.id}:${ch}`))]))),
    weekendUplifts: Object.fromEntries(units.flatMap(u => OTA_CHANNELS.map(ch => [`${u.id}:${ch}`, upliftFor(ch, weekendOf(u) ?? Number(u.base_rate), upliftOf.get(`${u.id}:${ch}`))]))),
    // For pricing new web prices in Rate update: uplifts set by hand, and the share each site adds otherwise.
    savedUplifts: Object.fromEntries(uplifts.map(x => [`${x.unit_id}:${x.channel}`, Number(x.uplift)])),
    upliftShares: Object.fromEntries(OTA_CHANNELS.map(ch => [ch, defaultUpliftShare(ch)])),
    canSetRates,
    // Nights priced by hand, keyed "unitId:channel:date" (channel 'web' is the direct rate).
    rates: Object.fromEntries(rates.map(r => [`${r.unit_id}:${r.channel}:${r.rate_date}`, Number(r.rate)])),
    // Nights with a minimum stay above one or closed for sale, keyed "unitId:date".
    restrictions: Object.fromEntries(restr.map(r => [`${r.unit_id}:${r.rate_date}`, { minStay: r.min_stay ?? 1, stopSell: !!r.stop_sell }])),
    blocks: blocks.map(b => ({
      id: b.id, unitId: b.unit_id, channel: b.channel, state: b.state,
      guestName: b.guest_name || (b.channel === 'maintenance_block' ? (b.notes ?? 'Blocked') : ''),
      checkIn: b.check_in, checkOut: b.check_out,
      grossBookingValue: Number(b.gross_booking_value), ref: b.external_ref,
      // The note is already the block's name when there is no guest; sending it twice doubles the payload.
      reason: b.guest_name || b.channel !== 'maintenance_block' ? b.notes : null,
      blockReason: b.block_reason ?? null,
    })),
  });
};
