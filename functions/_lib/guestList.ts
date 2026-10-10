import { type Env, one } from './db';

/** The guest directory list: lifetime figures and today/tomorrow movement computed in SQL, so the
 *  screen can page and search thousands of guests without loading every stay. */

export const CONTACT_ROLES = ['management', 'operations_manager', 'operations_staff'];

export const FILTERS = ['all', 'arriving_today', 'departing_today', 'tomorrow', 'missing_id', 'repeat', 'vip', 'blacklist'] as const;
export type GuestFilter = typeof FILTERS[number];

export const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function todayAndTomorrow() {
  const now = Date.now() + 8 * 3600e3;
  return { today: new Date(now).toISOString().slice(0, 10), tomorrow: new Date(now + 864e5).toISOString().slice(0, 10) };
}

export const MANUAL_TAGS = ['vip', 'blacklist'] as const;
export type ManualTag = typeof MANUAL_TAGS[number];
export interface Tag { key: string; label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'critical' }

/** Automatic tags from the stays (Repeat = two or more stays, upcoming ones included; New otherwise; Direct when the
 *  latest booking came direct) and the manual ones people set (VIP, Blacklist). */
export function guestTags(stays: number, latestChannel: string | null, manual: string): Tag[] {
  const out: Tag[] = [];
  const m = new Set(String(manual ?? '').split(',').filter(Boolean));
  if (m.has('blacklist')) out.push({ key: 'blacklist', label: 'Blacklist', tone: 'critical' });
  if (m.has('vip')) out.push({ key: 'vip', label: 'VIP', tone: 'warning' });
  out.push(stays >= 2 ? { key: 'repeat', label: 'Repeat', tone: 'success' } : { key: 'new', label: stays ? 'New' : 'No stays yet', tone: 'neutral' });
  if (latestChannel === 'direct') out.push({ key: 'direct', label: 'Direct', tone: 'info' });
  return out;
}

/** Whether migration 0091's guest columns are on this database. */
export async function hasGuestColumns(env: Env): Promise<boolean> {
  const r = await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name = 'guests'
    AND table_schema = ANY(current_schemas(false)) AND column_name IN ('tags', 'id_type', 'id_number', 'date_of_birth', 'merged_into', 'notes', 'language')`);
  return Number(r?.n ?? 0) === 7;
}

/** Registration details Malaysian short-stay rules ask for: an ID document, its number, date of birth, nationality. */
export const MISSING_ID = `(g.id_type IS NULL OR COALESCE(g.id_number, '') = '' OR g.date_of_birth IS NULL OR g.country_code IS NULL)`;

/** Per guest: the same figures the profile shows. A stay counts once it is booked (upcoming ones included), so a
 *  guest arriving today reads "1 stay (1 upcoming)", not 0. A guest with a movement today is not also listed under
 *  tomorrow, and an arrival wins over a departure, matching the profile's single movement. */
export function statsCte(today: string, tomorrow: string) {
  const T = `'${today}'`, TM = `'${tomorrow}'`;
  const UPCOMING = `r.state IN ('confirmed','pending') AND r.check_in >= ${T}`;
  const ARRIVES = `r.state IN ('confirmed','pending','checked_in')`;
  const LEAVES = `r.state IN ('checked_in','checked_out')`;
  // MATERIALIZED: computed once. Inlined, the planner re-ran the aggregate per guest under some filters (25 s for Missing ID).
  return `WITH s AS MATERIALIZED (
    SELECT r.guest_id,
           COUNT(*) AS stays,
           COUNT(*) FILTER (WHERE ${UPCOMING}) AS upcoming,
           COALESCE(SUM(GREATEST(1, r.check_out::date - r.check_in::date)), 0) AS nights,
           COALESCE(SUM(r.gross_booking_value), 0) AS value,
           MAX(r.check_in) AS last_check_in,
           (array_agg(r.channel ORDER BY r.check_in DESC))[1] AS channel,
           bool_or(${ARRIVES} AND r.check_in = ${T}) AS arr_today,
           bool_or(${LEAVES} AND r.check_out = ${T}) AS dep_today,
           bool_or((${ARRIVES} AND r.check_in = ${TM}) OR (${LEAVES} AND r.check_out = ${TM})) AS tmr,
           bool_or(r.state IN ('confirmed','pending','checked_in') AND r.check_out >= ${T}) AS live
    FROM reservations r
    WHERE r.guest_id IS NOT NULL AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.state NOT IN ('cancelled','no_show','inquiry')
    GROUP BY r.guest_id)`;
}

export function filterWhere(f: GuestFilter, cols: boolean): string {
  switch (f) {
    case 'arriving_today': return 'COALESCE(s.arr_today, false)';
    case 'departing_today': return 'COALESCE(s.dep_today AND NOT s.arr_today, false)';
    case 'tomorrow': return 'COALESCE(s.tmr AND NOT s.arr_today AND NOT s.dep_today, false)';
    // Only guests with a stay coming or under way: their details are needed before (or at) check-in.
    case 'missing_id': return cols ? `COALESCE(s.live, false) AND ${MISSING_ID}` : 'FALSE';
    case 'repeat': return 'COALESCE(s.stays, 0) >= 2';
    case 'vip': return cols ? `g.tags ~ '(^|,)vip(,|$)'` : 'FALSE';
    case 'blacklist': return cols ? `g.tags ~ '(^|,)blacklist(,|$)'` : 'FALSE';
    default: return 'TRUE';
  }
}

/** Sort keys: the expression and the direction a bare key (old links, `?sort=value`) has always meant. */
const SORT_KEYS: Record<string, { expr: string; dir: 'asc' | 'desc' }> = {
  name: { expr: 'lower(g.full_name)', dir: 'asc' },
  recent: { expr: 's.last_check_in', dir: 'desc' },
  value: { expr: 'COALESCE(s.value, 0)', dir: 'desc' },
  stays: { expr: 'COALESCE(s.stays, 0)', dir: 'desc' },
  nights: { expr: 'COALESCE(s.nights, 0)', dir: 'desc' },
  upcoming: { expr: 'COALESCE(s.upcoming, 0)', dir: 'desc' },
};

/** `name`, `recent:asc`, `value:desc` ... into ORDER BY. Unknown keys fall back to `fallback`. Guests without a stay
 *  sort last either way. */
export function guestSort(raw: string | null, fallback = 'name'): { key: string; dir: 'asc' | 'desc'; sql: string } {
  const [k, d] = (raw ?? '').split(':');
  const key = SORT_KEYS[k] ? k : fallback;
  const dir = SORT_KEYS[k] && (d === 'asc' || d === 'desc') ? d : SORT_KEYS[key].dir;
  const { expr } = SORT_KEYS[key];
  const tie = key === 'name' ? 'g.id' : 'lower(g.full_name), g.id';
  return { key, dir, sql: `${expr} ${dir.toUpperCase()}${key === 'recent' ? ' NULLS LAST' : ''}, ${tie}` };
}

/** The last four characters of an ID number, the rest hidden. */
export const maskId = (v: string | null | undefined) => (v ? `•••• ${v.replace(/\s+/g, '').slice(-4)}` : null);
