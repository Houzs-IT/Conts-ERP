import { type Env, one } from './db';

/** The Bookings list: one place that turns the screen's URL (view tab, column searches, sort)
 *  into SQL, shared by the paged list, its CSV export and the single-booking read. */

export const VIEWS = ['upcoming', 'arriving', 'inhouse', 'unpaid', 'payout', 'past', 'cancelled', 'blocks', 'all'] as const;
export type View = typeof VIEWS[number];

export const SEARCH_KEYS = ['q', 'ref', 'guest', 'unit', 'channel', 'stay', 'gross', 'status'] as const;
type SearchKey = typeof SEARCH_KEYS[number];

const SORTS: Record<string, string> = {
  reference: 'r.external_ref', guest: 'lower(COALESCE(g.full_name, \'\'))', unit: 'lower(u.unit_number)',
  channel: 'r.channel', stay: 'r.check_in', gross: 'r.gross_booking_value', status: 'r.state',
};

const BLOCK = `r.channel IN ('maintenance_block','owner_stay')`;
const DEAD = `r.state IN ('cancelled','no_show')`;
const OTA = `r.channel IN ('airbnb','booking_com','agoda')`;

/** Whether reservations has the payout columns of migration 0052, which say when a booking site paid us. */
export async function hasPayoutColumns(env: Env): Promise<boolean> {
  const r = await one<{ n: number }>(env, `
    SELECT COUNT(*) AS n FROM information_schema.columns
    WHERE table_name = 'reservations' AND table_schema = ANY(current_schemas(false)) AND column_name IN ('payout_date', 'payout_amount')`);
  return Number(r?.n ?? 0) === 2;
}
/** No payout recorded: the 0052 payout columns when they exist, and collected revenue in every case. */
const noPayout = (payoutCols: boolean) =>
  payoutCols ? `(r.collected_revenue <= 0 AND r.payout_date IS NULL AND COALESCE(r.payout_amount, 0) <= 0)` : `r.collected_revenue <= 0`;

/** The amount still owed for the two money tabs: the guest owes a direct booking's value, a booking site owes
 *  the booking value less its commission. Other tabs have no outstanding figure. */
export function outstandingExpr(v: View, payoutCols: boolean): string | null {
  if (v === 'unpaid') return `GREATEST(r.gross_booking_value - r.collected_revenue${payoutCols ? ' - COALESCE(r.payout_amount, 0)' : ''}, 0)`;
  if (v === 'payout') return `GREATEST(r.gross_booking_value - r.channel_fee, 0)`;
  return null;
}

const CHANNEL_LABEL = `CASE r.channel WHEN 'airbnb' THEN 'Airbnb' WHEN 'booking_com' THEN 'Booking.com' WHEN 'agoda' THEN 'Agoda'
  WHEN 'direct' THEN 'Direct' WHEN 'owner_stay' THEN 'Owner stay' ELSE 'Block' END`;
const STATE_LABEL = `CASE r.state WHEN 'inquiry' THEN 'Inquiry' WHEN 'pending' THEN 'Pending' WHEN 'confirmed' THEN 'Confirmed'
  WHEN 'checked_in' THEN 'Checked in' WHEN 'checked_out' THEN 'Checked out' WHEN 'cancelled' THEN 'Cancelled' ELSE 'No show' END`;

export const FROM = `FROM reservations r
  LEFT JOIN guests g ON g.id = r.guest_id
  JOIN units u ON u.id = r.unit_id
  JOIN properties p ON p.id = u.property_id`;

export const COLUMNS = `r.id, r.external_ref, r.guests_count, r.channel, r.state, r.check_in, r.check_out, r.check_in_time, r.check_out_time,
  r.gross_booking_value, r.channel_fee, r.collected_revenue, r.created_at,
  COALESCE(g.full_name, '') AS guest_name, g.phone AS guest_phone, u.unit_number, p.name AS property_name`;

/** Today in Kuala Lumpur as YYYY-MM-DD. Interpolated into SQL, so it is built here, never taken from the request. */
export function todayMyt() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

/** The WHERE clause of each tab. Upcoming and Past split every live booking between them on check-out day. */
export function viewWhere(v: View, today: string, payoutCols = false): string {
  const t = `'${today}'`;
  switch (v) {
    case 'upcoming': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state <> 'checked_out' AND r.check_out >= ${t}`;
    case 'arriving': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.check_in = ${t}`;
    case 'inhouse': return `NOT ${BLOCK} AND r.state = 'checked_in'`;
    // Direct bookings the guest has not paid for yet. Booking sites collect from their guests, so they are not here.
    case 'unpaid': return `r.channel = 'direct' AND NOT ${DEAD} AND ${noPayout(payoutCols)}`;
    // Booking-site stays that are over and still have no payout recorded.
    case 'payout': return `${OTA} AND NOT ${DEAD} AND (r.state = 'checked_out' OR r.check_out <= ${t}) AND ${noPayout(payoutCols)}`;
    case 'past': return `NOT ${BLOCK} AND NOT ${DEAD} AND (r.state = 'checked_out' OR r.check_out < ${t})`;
    case 'cancelled': return `NOT ${BLOCK} AND ${DEAD}`;
    case 'blocks': return BLOCK;
    default: return `NOT ${BLOCK}`;
  }
}

/** Forward-looking tabs read soonest first; history tabs read newest first. */
const DEFAULT_ASC: Record<View, boolean> = {
  upcoming: true, arriving: true, inhouse: true, unpaid: true, payout: false, past: false, cancelled: false, blocks: false, all: false,
};

/** An ILIKE pattern that matches the text literally, wildcards included. */
export const like = (s: string) => `%${s.replace(/[\\%_]/g, m => '\\' + m)}%`;

export interface ListQuery {
  view: View; today: string;
  where: string; args: unknown[];
  orderBy: string;
  page: number; pageSize: number;
  searches: Partial<Record<SearchKey, string>>;
  sortLabel: string | null;
}

export function parseListQuery(url: URL): ListQuery {
  const sp = url.searchParams;
  // "pending" was the single payment tab before it was split; old links land on the direct-unpaid tab.
  const rawView = sp.get('view') === 'pending' ? 'unpaid' : (sp.get('view') ?? '');
  const view: View = (VIEWS as readonly string[]).includes(rawView) ? rawView as View : 'upcoming';
  const today = todayMyt();

  const conds: string[] = [];
  const args: unknown[] = [];
  const searches: ListQuery['searches'] = {};
  for (const k of SEARCH_KEYS) {
    const v = (sp.get(k) ?? '').trim().slice(0, 80);
    if (!v) continue;
    searches[k] = v;
    const p = like(v);
    switch (k) {
      case 'q': conds.push(`(r.external_ref ILIKE ? OR g.full_name ILIKE ? OR g.phone ILIKE ? OR u.unit_number ILIKE ? OR p.name ILIKE ?)`); args.push(p, p, p, p, p); break;
      case 'ref': conds.push('r.external_ref ILIKE ?'); args.push(p); break;
      case 'guest': conds.push('(g.full_name ILIKE ? OR g.phone ILIKE ?)'); args.push(p, p); break;
      case 'unit': conds.push('(u.unit_number ILIKE ? OR p.name ILIKE ?)'); args.push(p, p); break;
      case 'channel': conds.push(`(${CHANNEL_LABEL}) ILIKE ?`); args.push(p); break;
      case 'status': conds.push(`(${STATE_LABEL}) ILIKE ?`); args.push(p); break;
      // Matches what the Stay column shows ("12 Oct") as well as ISO dates ("2026-10").
      case 'stay': conds.push(`(r.check_in || ' ' || r.check_out || ' ' || to_char(r.check_in::date, 'FMDD Mon YYYY') || ' ' || to_char(r.check_out::date, 'FMDD Mon YYYY')) ILIKE ?`); args.push(p); break;
      case 'gross': conds.push(`to_char(r.gross_booking_value / 100.0, 'FM999999990.00') ILIKE ?`); args.push(like(v.replace(/[^0-9.]/g, ''))); break;
    }
  }

  const [sortKey, sortDir] = (sp.get('sort') ?? '').split(':');
  const sortExpr = SORTS[sortKey];
  const asc = sortExpr ? sortDir !== 'desc' : DEFAULT_ASC[view];
  const orderBy = `${sortExpr ?? 'r.check_in'} ${asc ? 'ASC' : 'DESC'}, r.check_in ${asc ? 'ASC' : 'DESC'}, r.id`;

  const size = Number(sp.get('size'));
  const pageSize = [25, 50, 100, 200].includes(size) ? size : 50;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(sp.get('page')) || 1)));

  return {
    view, today, where: conds.length ? conds.join(' AND ') : 'TRUE', args, orderBy, page, pageSize, searches,
    sortLabel: sortExpr ? `${sortKey} ${asc ? 'ascending' : 'descending'}` : null,
  };
}

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));

export function toRow(r: any) {
  return {
    id: r.id, externalRef: r.external_ref, guestName: r.guest_name, guestsCount: r.guests_count,
    guestPhone: r.guest_phone, unitNumber: r.unit_number, propertyName: r.property_name,
    channel: r.channel, state: r.state, checkIn: r.check_in, checkOut: r.check_out,
    checkInTime: r.check_in_time, checkOutTime: r.check_out_time,
    nights: nightsBetween(r.check_in, r.check_out), grossBookingValue: Number(r.gross_booking_value),
    channelFee: Number(r.channel_fee),
    collectedRevenue: Number(r.collected_revenue), createdAt: r.created_at,
  };
}
