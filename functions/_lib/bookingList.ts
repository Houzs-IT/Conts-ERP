import { moneySql } from './bookingMoney';
import { countryJoin, countryWhere, parseCountries, countryName } from './guestCountry';

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
 *  The to-do filters (arriving today, arriving soon = today or tomorrow, checking out today, unpaid, payout) sit on
 *  top of All, not tabs. */

export const VIEWS = ['upcoming', 'inhouse', 'past', 'cancelled', 'all'] as const;
export type View = typeof VIEWS[number];
export const TODOS = ['arriving', 'soon', 'departing', 'unpaid', 'payout'] as const;
export type Todo = typeof TODOS[number];

export const SEARCH_KEYS = ['q', 'ref', 'guest', 'unit', 'channel', 'stay', 'gross', 'status'] as const;
type SearchKey = typeof SEARCH_KEYS[number];
export const CHANNEL_FILTERS = ['airbnb', 'booking_com', 'agoda', 'direct'] as const;

const SORTS: Record<string, string> = {
  reference: 'r.external_ref', guest: 'lower(COALESCE(g.full_name, \'\'))', unit: 'lower(u.unit_number)',
  channel: 'r.channel', stay: 'r.check_in', gross: 'r.gross_booking_value', status: 'r.state',
  nights: '(r.check_out::date - r.check_in::date)', guests: 'r.guests_count', fee: 'r.channel_fee', created: 'r.created_at',
  country: 'gc.name',
};

export const BLOCK = `r.channel IN ('maintenance_block','owner_stay')`;
const DEAD = `r.state IN ('cancelled','no_show')`;
const OTA = `r.channel IN ('airbnb','booking_com','agoda')`;

const CHANNEL_LABEL = `CASE r.channel WHEN 'airbnb' THEN 'Airbnb' WHEN 'booking_com' THEN 'Booking.com' WHEN 'agoda' THEN 'Agoda'
  WHEN 'direct' THEN 'Direct' WHEN 'owner_stay' THEN 'Owner stay' ELSE 'Block' END`;
// The decided status words (docs/VOCABULARY.md): stored values stay, people read Upcoming / Currently hosting / Past.
const STATE_LABEL = `CASE r.state WHEN 'inquiry' THEN 'Inquiry' WHEN 'pending' THEN 'Pending' WHEN 'confirmed' THEN 'Upcoming'
  WHEN 'checked_in' THEN 'Currently hosting' WHEN 'checked_out' THEN 'Past' WHEN 'cancelled' THEN 'Cancelled' ELSE 'No-show' END`;
export const STATES = ['inquiry', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'] as const;

export interface Schema { payoutCols: boolean; payments: boolean }

/** FROM with the money join. Every list query reads money, so the join is always there. */
export const fromSql = (s: Schema) => `FROM reservations r
  LEFT JOIN guests g ON g.id = r.guest_id
  JOIN units u ON u.id = r.unit_id
  JOIN properties p ON p.id = u.property_id
  ${moneySql(s).join}
  ${countryJoin('gc', { phone: 'g.phone', stored: 'g.country_code', nationalityName: s.payoutCols ? 'r.guest_nationality' : null })}`;

export const columnsSql = (s: Schema) => {
  const m = moneySql(s);
  return `r.id, r.external_ref, r.guests_count, r.channel, r.state, r.check_in, r.check_out, r.check_in_time, r.check_out_time,
  r.gross_booking_value, r.channel_fee, r.collected_revenue, r.created_at, u.property_id,
  COALESCE(g.full_name, '') AS guest_name, g.phone AS guest_phone, g.country_code AS guest_country,
  ${s.payoutCols ? 'r.guest_nationality' : 'NULL::text'} AS guest_nationality,
  u.unit_number, p.name AS property_name, gc.iso AS country_iso, gc.src AS country_src,
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
    case 'soon': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state <> 'inquiry' AND r.check_in IN (${d}, '${nextDay(today)}')`;
    case 'departing': return `NOT ${BLOCK} AND NOT ${DEAD} AND r.state <> 'inquiry' AND r.check_out = ${d}`;
    // A direct guest who still owes money. Booking sites collect from their own guests, so they are not here.
    case 'unpaid': return `r.channel = 'direct' AND NOT ${DEAD} AND r.state <> 'inquiry' AND ${owed}`;
    // A booking-site stay that has ended (or is ending today) and has not been fully paid out to us.
    case 'payout': return `${OTA} AND NOT ${DEAD} AND r.state <> 'inquiry' AND (r.state = 'checked_out' OR r.check_out <= ${d}) AND ${owed}`;
  }
}

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** Forward-looking tabs read soonest first; history tabs read newest first. */
const DEFAULT_ASC: Record<View, boolean> = { upcoming: true, inhouse: true, past: false, cancelled: false, all: false };

/** An ILIKE pattern that matches the text literally, wildcards included. */
export const like = (s: string) => `%${s.replace(/[\\%_]/g, m => '\\' + m)}%`;

const DIGITS_ONLY = /^[\d\s+()\-./]+$/;

/** A typed phone number, however it is written (012-429 1909, +60 12-429 1909, 60124291909, 0065 9149 0674), as the
 *  digits after the 00 international prefix and the Malaysian country code or trunk 0; null when the text is not a
 *  phone number. Stored phones are compared the same way (phoneCoreSql). */
export function phoneCore(s: string): string | null {
  if (!DIGITS_ONLY.test(s)) return null;
  const d = s.replace(/\D/g, '').replace(/^00/, '');
  return d.length >= 6 ? d.replace(/^(60|0)/, '') : null;
}
export const phoneCoreSql = (col: string) => `regexp_replace(regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g'), '^(00)?(60|0)?', '')`;
const PHONE_CORE = phoneCoreSql('g.phone');
const PHONE_DIGITS = `regexp_replace(COALESCE(g.phone, ''), '[^0-9]', '', 'g')`;
const REF_DIGITS = `regexp_replace(COALESCE(r.external_ref, ''), '[^0-9]', '', 'g')`;

/** The search box, for what a guest says on the phone. Words are matched one by one in any order against the name,
 *  reference, phone, email, unit, building and country, so "tan wei" finds "Wei Ling Tan" and "Skyline D25" finds
 *  unit D25 in Skyline. Digits are a phone number in any format or a numeric reference (Booking.com, Agoda), with
 *  or without spaces; 4 or 5 digits are the end of a phone number, a unit or part of a reference.
 *  `country`: the query has the guest country join (gc). */
export function quickSearch(v: string, country = true): { sql: string; args: unknown[] }[] {
  const d = v.replace(/\D/g, '');
  const core = phoneCore(v);
  if (DIGITS_ONLY.test(v) && core) {
    return [{ sql: `(r.external_ref ILIKE ? OR ${REF_DIGITS} LIKE ? OR ${PHONE_CORE} LIKE ?)`, args: [like(v), like(d), like(core)] }];
  }
  if (DIGITS_ONLY.test(v) && d.length >= 4) {
    return [{ sql: `(${REF_DIGITS} LIKE ? OR u.unit_number ILIKE ? OR ${PHONE_DIGITS} LIKE ?)`, args: [like(d), like(v.trim()), `%${d}`] }];
  }
  return v.split(/\s+/).filter(Boolean).slice(0, 6).map(w => {
    const wp = like(w);
    return {
      sql: `(r.external_ref ILIKE ? OR g.full_name ILIKE ? OR g.phone ILIKE ? OR g.email ILIKE ? OR u.unit_number ILIKE ? OR p.name ILIKE ?${country ? ' OR gc.name ILIKE ?' : ''})`,
      args: [wp, wp, wp, wp, wp, wp, ...(country ? [wp] : [])],
    };
  });
}

export const FACETS = ['ch', 'building', 'st', 'country'] as const;
export type FacetKey = typeof FACETS[number];

export interface ListQuery {
  view: View; todo: Todo | null; today: string;
  /** Searches and filters, without the tab or the to-do card. */
  where: string; args: unknown[];
  /** The same without one filter, for that filter's counts (a channel's count ignores the channel picked). */
  whereExcept: (key: FacetKey) => { where: string; args: unknown[] };
  orderBy: string;
  page: number; pageSize: number;
  searches: Partial<Record<SearchKey, string>>;
  filters: {
    channel: string | null; property: string | null; from: string | null; to: string | null; grossMin: number | null; grossMax: number | null;
    country: string[]; states: string[]; nightsMin: number | null; nightsMax: number | null;
  };
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

  // Each condition remembers the filter it came from, so a filter's own counts can be worked out without it.
  const parts: { key: string; sql: string; args: unknown[] }[] = [];
  const add = (key: string, sql: string, a: unknown[] = []) => { parts.push({ key, sql, args: a }); };
  const searches: ListQuery['searches'] = {};
  for (const k of SEARCH_KEYS) {
    const v = (sp.get(k) ?? '').trim().slice(0, 80);
    if (!v) continue;
    searches[k] = v;
    const p = like(v);
    switch (k) {
      case 'q': for (const c of quickSearch(v)) add('q', c.sql, c.args); break;
      case 'ref': if (/^[\d\s-]+$/.test(v)) add('ref', `(r.external_ref ILIKE ? OR ${REF_DIGITS} LIKE ?)`, [p, like(v.replace(/\D/g, ''))]); else add('ref', 'r.external_ref ILIKE ?', [p]); break;
      case 'guest': {
        const core = phoneCore(v);
        add('guest', `(g.full_name ILIKE ? OR g.phone ILIKE ?${core ? ` OR ${PHONE_CORE} LIKE ?` : ''})`, [p, p, ...(core ? [like(core)] : [])]); break;
      }
      case 'unit': add('unit', '(u.unit_number ILIKE ? OR p.name ILIKE ?)', [p, p]); break;
      case 'channel': add('channel', `(${CHANNEL_LABEL}) ILIKE ?`, [p]); break;
      case 'status': add('status', `(${STATE_LABEL}) ILIKE ?`, [p]); break;
      // Matches what the Stay column shows ("12 Oct") as well as ISO dates ("2026-10").
      case 'stay': add('stay', `(r.check_in || ' ' || r.check_out || ' ' || to_char(r.check_in::date, 'FMDD Mon YYYY') || ' ' || to_char(r.check_out::date, 'FMDD Mon YYYY')) ILIKE ?`, [p]); break;
      case 'gross': add('gross', `to_char(r.gross_booking_value / 100.0, 'FM999999990.00') ILIKE ?`, [like(v.replace(/[^0-9.]/g, ''))]); break;
    }
  }

  // Filters: channels, buildings, statuses and countries (each a comma list), stays that touch a date range, nights.
  const list = (k: string) => (sp.get(k) ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 40);
  const channels = list('ch').filter(c => (CHANNEL_FILTERS as readonly string[]).includes(c));
  if (channels.length) add('ch', `r.channel IN (${channels.map(() => '?').join(', ')})`, channels);
  const buildings = list('building').map(b => b.slice(0, 80));
  if (buildings.length) add('building', `u.property_id IN (${buildings.map(() => '?').join(', ')})`, buildings);
  const states = list('st').filter(x => (STATES as readonly string[]).includes(x));
  if (states.length) add('st', `r.state IN (${states.map(() => '?').join(', ')})`, states);
  const countries = parseCountries(sp.get('country'));
  const cw = countryWhere('gc', countries);
  if (cw) add('country', cw.sql, cw.args);
  const from = ISO_DAY.test(sp.get('from') ?? '') ? sp.get('from')! : null;
  const to = ISO_DAY.test(sp.get('to') ?? '') ? sp.get('to')! : null;
  if (from) add('stay', 'r.check_out > ?', [from]);
  if (to) add('stay', 'r.check_in <= ?', [to]);
  const intArg = (k: string) => { const raw = sp.get(k); const n = Number(raw); return raw && Number.isInteger(n) && n >= 0 && n < 10000 ? n : null; };
  const nightsMin = intArg('nightsMin'), nightsMax = intArg('nightsMax');
  if (nightsMin !== null) add('nights', '(r.check_out::date - r.check_in::date) >= ?', [nightsMin]);
  if (nightsMax !== null) add('nights', '(r.check_out::date - r.check_in::date) <= ?', [nightsMax]);
  // Guest total between two amounts in ringgit (the table's number filter).
  const rmArg = (k: string) => { const v = sp.get(k); const n = v === null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
  const grossMin = rmArg('grossMin'), grossMax = rmArg('grossMax');
  if (grossMin !== null) add('grossRange', 'r.gross_booking_value >= ?', [grossMin]);
  if (grossMax !== null) add('grossRange', 'r.gross_booking_value <= ?', [grossMax]);

  const [sortKey, sortDir] = (sp.get('sort') ?? '').split(':');
  const sortExpr = SORTS[sortKey];
  const asc = sortExpr ? sortDir !== 'desc' : todo ? todo !== 'payout' : DEFAULT_ASC[view];
  const orderBy = `${sortExpr ?? 'r.check_in'} ${asc ? 'ASC' : 'DESC'}, r.check_in ${asc ? 'ASC' : 'DESC'}, r.id`;

  const size = Number(sp.get('size'));
  // export=1: the table's Export asks for every matching row in pages of up to 1,000 (src/lib/export.ts).
  const pageSize = sp.get('export') === '1' && Number.isInteger(size) && size >= 1 && size <= 1000 ? size : [25, 50, 100, 200].includes(size) ? size : 50;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(sp.get('page')) || 1)));

  const build = (skip: string | null) => {
    const use = skip ? parts.filter(x => x.key !== skip) : parts;
    return { where: use.length ? use.map(x => x.sql).join(' AND ') : 'TRUE', args: use.flatMap(x => x.args) };
  };
  const whole = build(null);
  return {
    view: viewFinal, todo, today, where: whole.where, args: whole.args, whereExcept: k => build(k), orderBy, page, pageSize, searches,
    filters: { channel: channels.join(',') || null, property: buildings.join(',') || null, from, to, grossMin, grossMax, country: countries, states, nightsMin, nightsMax },
    sortLabel: sortExpr ? `${sortKey} ${asc ? 'ascending' : 'descending'}` : null,
  };
}

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));

export function toRow(r: any) {
  return {
    id: r.id, externalRef: r.external_ref, guestName: r.guest_name, guestsCount: r.guests_count,
    guestPhone: r.guest_phone, guestCountry: r.guest_country ?? null, guestNationality: r.guest_nationality ?? null,
    country: r.country_iso ? { code: r.country_iso as string, name: countryName(r.country_iso), from: r.country_src as 'nationality' | 'phone' } : null,
    unitNumber: r.unit_number, propertyName: r.property_name, propertyId: r.property_id,
    channel: r.channel, state: r.state, checkIn: r.check_in, checkOut: r.check_out,
    checkInTime: r.check_in_time, checkOutTime: r.check_out_time,
    nights: nightsBetween(r.check_in, r.check_out), grossBookingValue: Number(r.gross_booking_value),
    channelFee: Number(r.channel_fee), collectedRevenue: Number(r.collected_revenue),
    expectedPayout: Number(r.expected_payout ?? 0), received: Number(r.received ?? 0), outstanding: Number(r.outstanding ?? 0),
    createdAt: r.created_at,
  };
}
