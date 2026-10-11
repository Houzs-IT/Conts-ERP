import { moneySql } from './bookingMoney';

/** The Bookings list: one place that turns the screen's URL (tab, to-do card, filters, searches, sort)
 *  into SQL, shared by the paged list, its CSV export and the single-booking read.
 *
 *  Five tabs, and every booking is in exactly one of them, so their counts add up to All:
 *    upcoming   not arrived yet and the stay has not ended
 *    inhouse    checked in
 *    past       checked out, or the stay ended without being checked in or out ("Checked out")
 *    cancelled  cancelled or no-show
 *    all
 *  Blocks and owner stays are not bookings and live on the calendar and the unit page, not here.
 *  The four to-do cards (arriving, departing, unpaid, payout) are filters on top of All, not tabs. */

export const VIEWS = ['upcoming', 'inhouse', 'past', 'cancelled', 'all'] as const;
export type View = typeof VIEWS[number];
export const TODOS = ['arriving', 'departing', 'unpaid', 'payout'] as const;
export type Todo = typeof TODOS[number];

export const SEARCH_KEYS = ['q', 'ref', 'guest', 'unit', 'channel', 'stay', 'gross', 'status'] as const;
type SearchKey = typeof SEARCH_KEYS[number];
export const CHANNEL_FILTERS = ['airbnb', 'booking_com', 'agoda', 'direct'] as const;

const SORTS: Record<string, string> = {
  reference: 'r.external_ref', guest: 'lower(COALESCE(g.full_name, \'\'))', unit: 'lower(u.unit_number)',
  channel: 'r.channel', stay: 'r.check_in', gross: 'r.gross_booking_value', status: 'r.state',
  nights: '(r.check_out::date - r.check_in::date)', guests: 'r.guests_count', fee: 'r.channel_fee', created: 'r.created_at',
};

export const BLOCK = `r.channel IN ('maintenance_block','owner_stay')`;
const DEAD = `r.state IN ('cancelled','no_show')`;
const OTA = `r.channel IN ('airbnb','booking_com','agoda')`;

const CHANNEL_LABEL = `CASE r.channel WHEN 'airbnb' THEN 'Airbnb' WHEN 'booking_com' THEN 'Booking.com' WHEN 'agoda' THEN 'Agoda'
  WHEN 'direct' THEN 'Direct' WHEN 'owner_stay' THEN 'Owner stay' ELSE 'Block' END`;
const STATE_LABEL = `CASE r.state WHEN 'inquiry' THEN 'Inquiry' WHEN 'pending' THEN 'Pending' WHEN 'confirmed' THEN 'Upcoming'
  WHEN 'checked_in' THEN 'Currently hosting' WHEN 'checked_out' THEN 'Past' WHEN 'cancelled' THEN 'Cancelled' ELSE 'No-show' END`;

export interface Schema { payoutCols: boolean; payments: boolean }

/** FROM with the money join. Every list query reads money, so the join is always there. */
export const fromSql = (s: Schema) => `FROM reservations r
  LEFT JOIN guests g ON g.id = r.guest_id
  JOIN units u ON u.id = r.unit_id
  JOIN properties p ON p.id = u.property_id
  ${moneySql(s).join}`;

export const columnsSql = (s: Schema) => {
  const m = moneySql(s);
  return `r.id, r.external_ref, r.guests_count, r.channel, r.state, r.check_in, r.check_out, r.check_in_time, r.check_out_time,
  r.gross_booking_value, r.channel_fee, r.collected_revenue, r.created_at, u.property_id,
  COALESCE(g.full_name, '') AS guest_name, g.phone AS guest_phone, g.country_code AS guest_country,
  ${s.payoutCols ? 'r.guest_nationality' : 'NULL::text'} AS guest_nationality,
  u.unit_number, p.name AS property_name,
  ${m.expected} AS expected_payout, ${m.received} AS received, ${m.outstanding} AS outstanding`;
};

/** Today in Kuala Lumpur as YYYY-MM-DD. Interpolated into SQL, so it is built here, never taken from the request. */
export function todayMyt() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

/** The WHERE clause of each tab. The four live tabs split every booking between them with no overlap. */
export function viewWhere(v: View, today: string): string {
  const t = `'${today}'`;
  switch (v) {
    case 'upcoming': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state NOT IN ('checked_in','checked_out') AND r.check_out >= ${t}`;
    case 'inhouse': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state = 'checked_in'`;
    case 'past': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state <> 'checked_in' AND (r.state = 'checked_out' OR r.check_out < ${t})`;
    case 'cancelled': return `NOT ${BLOCK} AND ${DEAD}`;
    default: return `NOT ${BLOCK}`;
  }
}

/** The to-do cards. Unpaid and payout read what is still owed, so recording the money takes a booking off them. */
export function todoWhere(t: Todo, today: string, s: Schema): string {
  const d = `'${today}'`;
  const owed = `${moneySql(s).outstanding} > 0`;
  switch (t) {
    case 'arriving': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state <> 'inquiry' AND r.check_in = ${d}`;
    case 'departing': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state <> 'inquiry' AND r.check_out = ${d}`;
    // A direct guest who still owes money. Booking sites collect from their own guests, so they are not here.
    case 'unpaid': return `r.channel = 'direct' AND NOT ${DEAD} AND r.state <> 'inquiry' AND ${owed}`;
    // A booking-site stay that has ended (or is ending today) and has not been fully paid out to us.
    case 'payout': return `${OTA} AND NOT ${DEAD} AND r.state <> 'inquiry' AND (r.state = 'checked_out' OR r.check_out <= ${d}) AND ${owed}`;
  }
}

/** Forward-looking tabs read soonest first; history tabs read newest first. */
const DEFAULT_ASC: Record<View, boolean> = { upcoming: true, inhouse: true, past: false, cancelled: false, all: false };

/** An ILIKE pattern that matches the text literally, wildcards included. */
export const like = (s: string) => `%${s.replace(/[\\%_]/g, m => '\\' + m)}%`;

/** A typed phone number, however it is written (012-429 1909, +60 12-429 1909, 60124291909), as the digits after
 *  the Malaysian country code or trunk 0; null when the text is not a phone number. Stored phones are compared the same way. */
export function phoneCore(s: string): string | null {
  if (!/^[\d\s+()\-.]+$/.test(s)) return null;
  const d = s.replace(/\D/g, '');
  return d.length >= 6 ? d.replace(/^(60|0)/, '') : null;
}
const PHONE_CORE = `regexp_replace(regexp_replace(COALESCE(g.phone, ''), '[^0-9]', '', 'g'), '^(60|0)', '')`;

export interface ListQuery {
  view: View; todo: Todo | null; today: string;
  /** Searches and dropdown filters, without the tab or the to-do card. */
  where: string; args: unknown[];
  orderBy: string;
  page: number; pageSize: number;
  searches: Partial<Record<SearchKey, string>>;
  filters: { channel: string | null; property: string | null; from: string | null; to: string | null; grossMin: number | null; grossMax: number | null };
  sortLabel: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Tabs that were split or renamed: old links still land somewhere sensible. */
const OLD_VIEWS: Record<string, { view: View; todo?: Todo }> = {
  pending: { view: 'all', todo: 'unpaid' }, unpaid: { view: 'all', todo: 'unpaid' }, payout: { view: 'all', todo: 'payout' },
  arriving: { view: 'all', todo: 'arriving' }, blocks: { view: 'all' },
};

export function parseListQuery(url: URL): ListQuery {
  const sp = url.searchParams;
  const rawView = sp.get('view') ?? '';
  const old = OLD_VIEWS[rawView];
  const view: View = old?.view ?? ((VIEWS as readonly string[]).includes(rawView) ? rawView as View : 'upcoming');
  const rawTodo = sp.get('todo') ?? '';
  const todo: Todo | null = (TODOS as readonly string[]).includes(rawTodo) ? rawTodo as Todo : old?.todo ?? null;
  // A to-do card filters every booking, whatever tab was open.
  const viewFinal: View = todo ? 'all' : view;
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
      case 'q': {
        // A phone number is matched on its digits; other text word by word, so "Skyline D25" finds unit D25 in Skyline.
        const core = phoneCore(v);
        if (core) { conds.push(`(r.external_ref ILIKE ? OR ${PHONE_CORE} LIKE ?)`); args.push(p, like(core)); break; }
        for (const w of v.split(/\s+/).filter(Boolean).slice(0, 6)) {
          const wp = like(w);
          conds.push(`(r.external_ref ILIKE ? OR g.full_name ILIKE ? OR g.phone ILIKE ? OR u.unit_number ILIKE ? OR p.name ILIKE ?)`); args.push(wp, wp, wp, wp, wp);
        }
        break;
      }
      case 'ref': conds.push('r.external_ref ILIKE ?'); args.push(p); break;
      case 'guest': {
        const core = phoneCore(v);
        conds.push(`(g.full_name ILIKE ? OR g.phone ILIKE ?${core ? ` OR ${PHONE_CORE} LIKE ?` : ''})`); args.push(p, p, ...(core ? [like(core)] : [])); break;
      }
      case 'unit': conds.push('(u.unit_number ILIKE ? OR p.name ILIKE ?)'); args.push(p, p); break;
      case 'channel': conds.push(`(${CHANNEL_LABEL}) ILIKE ?`); args.push(p); break;
      case 'status': conds.push(`(${STATE_LABEL}) ILIKE ?`); args.push(p); break;
      // Matches what the Stay column shows ("12 Oct") as well as ISO dates ("2026-10").
      case 'stay': conds.push(`(r.check_in || ' ' || r.check_out || ' ' || to_char(r.check_in::date, 'FMDD Mon YYYY') || ' ' || to_char(r.check_out::date, 'FMDD Mon YYYY')) ILIKE ?`); args.push(p); break;
      case 'gross': conds.push(`to_char(r.gross_booking_value / 100.0, 'FM999999990.00') ILIKE ?`); args.push(like(v.replace(/[^0-9.]/g, ''))); break;
    }
  }

  // Dropdown filters: one channel, one building, and stays that touch a date range.
  const ch = sp.get('ch') ?? '';
  const channel = (CHANNEL_FILTERS as readonly string[]).includes(ch) ? ch : null;
  if (channel) { conds.push('r.channel = ?'); args.push(channel); }
  const property = (sp.get('building') ?? '').slice(0, 80) || null;
  if (property) { conds.push('u.property_id = ?'); args.push(property); }
  const from = ISO_DAY.test(sp.get('from') ?? '') ? sp.get('from')! : null;
  const to = ISO_DAY.test(sp.get('to') ?? '') ? sp.get('to')! : null;
  if (from) { conds.push('r.check_out > ?'); args.push(from); }
  if (to) { conds.push('r.check_in <= ?'); args.push(to); }
  // Guest total between two amounts in ringgit (the table's number filter).
  const rmArg = (k: string) => { const v = sp.get(k); const n = v === null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
  const grossMin = rmArg('grossMin'), grossMax = rmArg('grossMax');
  if (grossMin !== null) { conds.push('r.gross_booking_value >= ?'); args.push(grossMin); }
  if (grossMax !== null) { conds.push('r.gross_booking_value <= ?'); args.push(grossMax); }

  const [sortKey, sortDir] = (sp.get('sort') ?? '').split(':');
  const sortExpr = SORTS[sortKey];
  const asc = sortExpr ? sortDir !== 'desc' : todo ? todo !== 'payout' : DEFAULT_ASC[view];
  const orderBy = `${sortExpr ?? 'r.check_in'} ${asc ? 'ASC' : 'DESC'}, r.check_in ${asc ? 'ASC' : 'DESC'}, r.id`;

  const size = Number(sp.get('size'));
  // export=1: the table's Export asks for every matching row in pages of up to 1,000 (src/lib/export.ts).
  const pageSize = sp.get('export') === '1' && Number.isInteger(size) && size >= 1 && size <= 1000 ? size : [25, 50, 100, 200].includes(size) ? size : 50;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(sp.get('page')) || 1)));

  return {
    view: viewFinal, todo, today, where: conds.length ? conds.join(' AND ') : 'TRUE', args, orderBy, page, pageSize, searches,
    filters: { channel, property, from, to, grossMin, grossMax },
    sortLabel: sortExpr ? `${sortKey} ${asc ? 'ascending' : 'descending'}` : null,
  };
}

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));

export function toRow(r: any) {
  return {
    id: r.id, externalRef: r.external_ref, guestName: r.guest_name, guestsCount: r.guests_count,
    guestPhone: r.guest_phone, guestCountry: r.guest_country ?? null, guestNationality: r.guest_nationality ?? null,
    unitNumber: r.unit_number, propertyName: r.property_name, propertyId: r.property_id,
    channel: r.channel, state: r.state, checkIn: r.check_in, checkOut: r.check_out,
    checkInTime: r.check_in_time, checkOutTime: r.check_out_time,
    nights: nightsBetween(r.check_in, r.check_out), grossBookingValue: Number(r.gross_booking_value),
    channelFee: Number(r.channel_fee), collectedRevenue: Number(r.collected_revenue),
    expectedPayout: Number(r.expected_payout ?? 0), received: Number(r.received ?? 0), outstanding: Number(r.outstanding ?? 0),
    createdAt: r.created_at,
  };
}
