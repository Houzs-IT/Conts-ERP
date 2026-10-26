import { type Env, all, one } from './db';
import { COUNTED_STAY, nightsBetween, stayMonths, metrics, monthEndExclusive, daysInMonth } from './revenue';
import { rentalOnly } from './unitPurpose';
import { monthsBack, todayMyt } from './ops';
import { standardRate } from './channelPrice';

/** Owner Showcase (CONTS-0006): the figures sales staff show a prospective owner, and the ones Showcase control may
 *  replace. Overrides apply to the portfolio ("All properties") only; a single property always shows its own figures.
 *  Page views and search impressions have no live source (Channex does not pass Airbnb's listing statistics on), so
 *  they show only when someone types them in. */
export const SHOWCASE_KEYS = [
  'today_in', 'today_out', 'today_up', 'tn_occ', 'tn_pct', 'tn_turn', 'listings',
  'rev_count', 'rev_five', 'rev_rating', 'occ_rate', 'occ_cancel', 'occ_stay', 'occ_year',
  'lead_avg', 'lead_b0', 'lead_b1', 'lead_b2', 'lead_b3', 'lead_b4', 'views_pv', 'views_imp',
] as const;
export type ShowcaseKey = typeof SHOWCASE_KEYS[number];
export const isShowcaseKey = (k: unknown): k is ShowcaseKey => typeof k === 'string' && (SHOWCASE_KEYS as readonly string[]).includes(k);

export type Live = Record<ShowcaseKey, number | null>;
export interface Override { value: number; active: boolean }

const DAY = 864e5;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
const LEAD_DAYS = `(r.check_in::date - (r.created_at::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date)`;
const LISTING_NAME = `COALESCE(NULLIF(btrim(u.listing_name), ''), p.name || ' ' || u.unit_number)`;

/** Guests are shown by first name and surname initial ("Nurul A.") to a room of strangers. */
export function maskGuest(full: string | null | undefined): string {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Guest';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/** Whether migration 0164 is applied. Remembered once it is. */
let seen = false;
export async function showcaseReady(env: Env): Promise<boolean> {
  if (seen) return true;
  const r = await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_name = 'showcase_overrides' AND table_schema = ANY(current_schemas(false))`);
  seen = Number(r?.n ?? 0) === 1;
  return seen;
}

export async function readOverrides(env: Env): Promise<Partial<Record<ShowcaseKey, Override>>> {
  if (!(await showcaseReady(env))) return {};
  const rows = await all<{ key: string; value: number; active: number }>(env, 'SELECT key, value, active FROM showcase_overrides');
  const out: Partial<Record<ShowcaseKey, Override>> = {};
  for (const r of rows) if (isShowcaseKey(r.key)) out[r.key] = { value: Number(r.value), active: Number(r.active) === 1 };
  return out;
}

export interface ShowcaseUnit {
  id: string; name: string; unit: string; city: string | null; photoId: string | null; rating: number | null; reviews: number;
  bedrooms: number; bathrooms: number; maxGuests: number; airbnbId: string | null;
}

/** Listed rental units with what a listing card needs. The cover photo is the unit's newest photo (Units screen). */
export async function showcaseUnits(env: Env, unitId?: string | null): Promise<ShowcaseUnit[]> {
  const rows = await all<any>(env, `
    SELECT u.id, ${LISTING_NAME} AS name, p.name || ' ' || u.unit_number AS unit, NULLIF(btrim(p.city), '') AS city, u.bedrooms, u.bathrooms, u.max_guests,
           (SELECT d.id FROM documents d WHERE d.unit_id = u.id AND d.kind = 'photo' AND d.maintenance_id IS NULL AND d.task_id IS NULL AND d.mime_type LIKE 'image/%' ORDER BY d.created_at DESC LIMIT 1) AS photo_id,
           (SELECT ROUND(AVG(v.rating)::numeric, 2) FROM reviews v WHERE v.unit_id = u.id) AS rating,
           (SELECT count(*)::int FROM reviews v WHERE v.unit_id = u.id) AS reviews,
           (SELECT NULLIF(btrim(c.external_ref), '') FROM unit_channels c WHERE c.unit_id = u.id AND c.channel = 'airbnb' AND c.is_active = 1 LIMIT 1) AS airbnb_id
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.is_listed = 1${await rentalOnly(env)}${unitId ? ' AND u.id = ?' : ''}
    ORDER BY name`, ...(unitId ? [unitId] : []));
  return rows.map(r => ({
    id: r.id, name: r.name, unit: r.unit, city: r.city ?? null, photoId: r.photo_id ?? null, rating: r.rating === null ? null : Number(r.rating),
    reviews: Number(r.reviews ?? 0), bedrooms: Number(r.bedrooms ?? 1), bathrooms: Number(r.bathrooms ?? 1), maxGuests: Number(r.max_guests ?? 2), airbnbId: r.airbnb_id ?? null,
  }));
}

export interface TodayItem { id: string; time: string; guest: string; guests: number; listing: string; unit: string; checkIn: string; checkOut: string; photoId: string | null }
export interface TodayBlock {
  date: string;
  checkIns: { count: number; items: TodayItem[] }; checkOuts: { count: number; items: TodayItem[] }; upcoming: { count: number; items: TodayItem[] };
  tonight: { occupied: number; listings: number; pct: number; turnovers: number };
}

/** Today's arrivals, departures, the stays on the books and tonight, across listed rental units. */
export async function todayBlock(env: Env, units: ShowcaseUnit[]): Promise<TodayBlock> {
  const today = todayMyt();
  const ids = JSON.stringify(units.map(u => u.id));
  const byId = new Map(units.map(u => [u.id, u]));
  const IN_UNITS = `r.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`;
  const list = async (where: string, order: string, time: (r: any) => string, ...args: unknown[]) => {
    const [n, rows] = await Promise.all([
      one<{ n: number }>(env, `SELECT count(*)::int AS n FROM reservations r WHERE ${COUNTED_STAY} AND ${IN_UNITS} AND ${where}`, ids, ...args),
      all<any>(env, `
        SELECT r.id, r.unit_id, r.check_in, r.check_out, r.check_in_time, r.check_out_time, r.guests_count, g.full_name
        FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
        WHERE ${COUNTED_STAY} AND ${IN_UNITS} AND ${where} ORDER BY ${order} LIMIT 8`, ids, ...args),
    ]);
    return {
      count: Number(n?.n ?? 0),
      items: rows.map(r => {
        const u = byId.get(r.unit_id);
        return { id: r.id, time: time(r), guest: maskGuest(r.full_name), guests: Number(r.guests_count ?? 1), listing: u?.name ?? '', unit: u?.unit ?? '', checkIn: r.check_in, checkOut: r.check_out, photoId: u?.photoId ?? null };
      }),
    };
  };
  const [checkIns, checkOuts, upcoming, tn] = await Promise.all([
    list('r.check_in = ?', 'r.check_in_time, r.id', r => r.check_in_time || '15:00', today),
    list('r.check_out = ?', 'r.check_out_time, r.id', r => r.check_out_time || '11:00', today),
    list('r.check_in > ?', 'r.check_in, r.check_in_time, r.id', () => '', today),
    one<{ occupied: number; turnovers: number }>(env, `
      SELECT (SELECT count(DISTINCT r.unit_id)::int FROM reservations r WHERE ${COUNTED_STAY} AND ${IN_UNITS} AND r.check_in <= ? AND r.check_out > ?) AS occupied,
             (SELECT count(DISTINCT r.unit_id)::int FROM reservations r WHERE ${COUNTED_STAY} AND ${IN_UNITS} AND r.check_out = ?
                AND EXISTS (SELECT 1 FROM reservations x WHERE x.unit_id = r.unit_id AND x.check_in = ? AND x.state IN ('confirmed','checked_in','checked_out') AND x.channel NOT IN ('maintenance_block','owner_stay'))) AS turnovers`,
      ids, today, today, ids, today, today),
  ]);
  const occupied = Number(tn?.occupied ?? 0);
  return {
    date: today, checkIns, checkOuts, upcoming,
    tonight: { occupied, listings: units.length, pct: units.length ? Math.round((occupied / units.length) * 100) : 0, turnovers: Number(tn?.turnovers ?? 0) },
  };
}

export interface ReviewCard { id: string; guest: string; stay: string | null; listing: string; rating: number; text: string; reviewedAt: string }

/** The newest five-star reviews that say something, newest first. */
export async function fiveStarReviews(env: Env, units: ShowcaseUnit[], limit: number): Promise<ReviewCard[]> {
  const byId = new Map(units.map(u => [u.id, u]));
  const rows = await all<any>(env, `
    SELECT v.id, v.unit_id, v.rating, v.comment, v.reviewed_at, g.full_name, r.check_in, r.check_out
    FROM reviews v LEFT JOIN reservations r ON r.id = v.reservation_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE v.rating >= 4.95 AND NULLIF(btrim(v.comment), '') IS NOT NULL AND v.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    ORDER BY v.reviewed_at DESC LIMIT ?`, JSON.stringify(units.map(u => u.id)), limit);
  return rows.map(r => ({
    id: r.id, guest: maskGuest(r.full_name), stay: r.check_in && r.check_out ? `${r.check_in}|${r.check_out}` : null,
    listing: byId.get(r.unit_id)?.name ?? '', rating: Number(r.rating), text: String(r.comment).trim(), reviewedAt: String(r.reviewed_at).slice(0, 10),
  }));
}

export interface Insights {
  from: string; to: string; days: number; units: number;
  reviews: { count: number; fiveStar: number; rating: number | null };
  occupancy: { rate: number; cancel: number; avgStay: number; bookedPerListing: number; blockedPerListing: number; unbookedPerListing: number; checkInsPerListing: number; year: number; months: { month: string; occupancy: number }[] };
  lead: { avg: number; buckets: number[]; rows: { unitId: string; name: string; unit: string; photoId: string | null; lead: number; bookings: number; rate: number }[] };
}

/** Lead time buckets in days: 0-2, 3-7, 8-14, 15-30, over 30. */
const BUCKET_TOP = [2, 7, 14, 30];

/** Reviews, occupancy and lead time for listed rental units (or one) over [from, to]. Booking lead time is the days
 *  between when the booking reached us and check-in; an imported booking recorded after its check-in is left out. */
export async function insights(env: Env, portfolio: ShowcaseUnit[], from: string, to: string, unitId?: string | null): Promise<Insights> {
  const units = unitId ? portfolio.filter(u => u.id === unitId) : portfolio;
  const end = addDays(to, 1);
  const days = Math.max(1, nightsBetween(from, end));
  const n = units.length;
  const ids = JSON.stringify(units.map(u => u.id));
  const IN_UNITS = `r.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`;
  const OVERLAP = `GREATEST(0, LEAST(r.check_out::date, ?::date) - GREATEST(r.check_in::date, ?::date))`;

  const today = todayMyt();
  const yearMonths = monthsBack(today, 12);
  const yearFrom = `${yearMonths[0]}-01`, yearTo = monthEndExclusive(yearMonths[yearMonths.length - 1]);

  const [nights, stays, perUnit, rev, year] = await Promise.all([
    one<{ booked: number; blocked: number }>(env, `
      SELECT COALESCE(SUM(${OVERLAP}) FILTER (WHERE ${COUNTED_STAY}), 0)::int AS booked,
             COALESCE(SUM(${OVERLAP}) FILTER (WHERE r.channel IN ('maintenance_block','owner_stay') AND r.state NOT IN ('cancelled','no_show')), 0)::int AS blocked
      FROM reservations r WHERE ${IN_UNITS} AND r.check_in < ? AND r.check_out > ?`, end, from, end, from, ids, end, from),
    one<{ counted: number; cancelled: number; nights: number; lead_n: number; lead_sum: number; b0: number; b1: number; b2: number; b3: number; b4: number }>(env, `
      SELECT count(*) FILTER (WHERE ${COUNTED_STAY})::int AS counted,
             count(*) FILTER (WHERE r.state = 'cancelled' AND r.channel NOT IN ('maintenance_block','owner_stay'))::int AS cancelled,
             COALESCE(SUM(r.check_out::date - r.check_in::date) FILTER (WHERE ${COUNTED_STAY}), 0)::int AS nights,
             count(*) FILTER (WHERE ${COUNTED_STAY} AND ${LEAD_DAYS} >= 0)::int AS lead_n,
             COALESCE(SUM(${LEAD_DAYS}) FILTER (WHERE ${COUNTED_STAY} AND ${LEAD_DAYS} >= 0), 0)::float8 AS lead_sum,
             count(*) FILTER (WHERE ${COUNTED_STAY} AND ${LEAD_DAYS} BETWEEN 0 AND ${BUCKET_TOP[0]})::int AS b0,
             count(*) FILTER (WHERE ${COUNTED_STAY} AND ${LEAD_DAYS} BETWEEN ${BUCKET_TOP[0] + 1} AND ${BUCKET_TOP[1]})::int AS b1,
             count(*) FILTER (WHERE ${COUNTED_STAY} AND ${LEAD_DAYS} BETWEEN ${BUCKET_TOP[1] + 1} AND ${BUCKET_TOP[2]})::int AS b2,
             count(*) FILTER (WHERE ${COUNTED_STAY} AND ${LEAD_DAYS} BETWEEN ${BUCKET_TOP[2] + 1} AND ${BUCKET_TOP[3]})::int AS b3,
             count(*) FILTER (WHERE ${COUNTED_STAY} AND ${LEAD_DAYS} > ${BUCKET_TOP[3]})::int AS b4
      FROM reservations r WHERE ${IN_UNITS} AND r.check_in >= ? AND r.check_in < ?`, ids, from, end),
    all<{ unit_id: string; bookings: number; lead_n: number; lead_sum: number; nights: number; gross: number }>(env, `
      SELECT r.unit_id, count(*)::int AS bookings,
             count(*) FILTER (WHERE ${LEAD_DAYS} >= 0)::int AS lead_n,
             COALESCE(SUM(${LEAD_DAYS}) FILTER (WHERE ${LEAD_DAYS} >= 0), 0)::float8 AS lead_sum,
             COALESCE(SUM(r.check_out::date - r.check_in::date), 0)::int AS nights,
             COALESCE(SUM(r.gross_booking_value), 0)::float8 AS gross
      FROM reservations r WHERE ${COUNTED_STAY} AND ${IN_UNITS} AND r.check_in >= ? AND r.check_in < ? GROUP BY r.unit_id`, ids, from, end),
    one<{ n: number; five: number; avg: number | null }>(env, `
      SELECT count(*)::int AS n, count(*) FILTER (WHERE v.rating >= 4.95)::int AS five, AVG(v.rating)::float8 AS avg
      FROM reviews v WHERE v.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND substr(v.reviewed_at, 1, 10) BETWEEN ? AND ?`, ids, from, to),
    stayMonths(env, yearFrom, yearTo, unitId ? { unitId } : {}),
  ]);

  const booked = Number(nights?.booked ?? 0), blocked = Number(nights?.blocked ?? 0);
  const available = n * days;
  const per30 = (v: number) => (n ? round1((v / n) * (30 / days)) : 0);
  const s = stays!;
  const counted = Number(s.counted), cancelled = Number(s.cancelled), leadN = Number(s.lead_n);
  const bucketCounts = [s.b0, s.b1, s.b2, s.b3, s.b4].map(Number);
  const inSet = new Set(units.map(u => u.id));
  const yearRows = year.filter(r => inSet.has(r.unit_id));
  const yearAvailable = yearMonths.reduce((sum, m) => sum + n * (m === today.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth(m)), 0);
  const byUnit = new Map(units.map(u => [u.id, u]));

  return {
    from, to, days, units: n,
    reviews: { count: Number(rev?.n ?? 0), fiveStar: rev?.n ? round1((Number(rev.five) / Number(rev.n)) * 100) : 0, rating: rev?.avg === null || rev?.avg === undefined ? null : Math.round(Number(rev.avg) * 100) / 100 },
    occupancy: {
      rate: available ? Math.min(100, round1((booked / available) * 100)) : 0,
      cancel: counted + cancelled ? round1((cancelled / (counted + cancelled)) * 100) : 0,
      avgStay: counted ? round1(Number(s.nights) / counted) : 0,
      bookedPerListing: per30(booked), blockedPerListing: per30(blocked), unbookedPerListing: per30(Math.max(0, available - booked - blocked)),
      checkInsPerListing: per30(counted),
      year: metrics(yearRows, yearAvailable).occupancy,
      months: yearMonths.map(m => {
        const avail = n * (m === today.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth(m));
        return { month: m, occupancy: Math.round(metrics(yearRows.filter(r => r.month === m), avail).occupancy) };
      }),
    },
    lead: {
      avg: leadN ? round1(Number(s.lead_sum) / leadN) : 0,
      buckets: bucketCounts.map(c => (leadN ? Math.round((c / leadN) * 100) : 0)),
      rows: perUnit.map(r => {
        const u = byUnit.get(r.unit_id);
        return {
          unitId: r.unit_id, name: u?.name ?? '', unit: u?.unit ?? '', photoId: u?.photoId ?? null,
          lead: Number(r.lead_n) ? round1(Number(r.lead_sum) / Number(r.lead_n)) : 0, bookings: Number(r.bookings),
          rate: Number(r.nights) ? Math.round(Number(r.gross) / Number(r.nights) / 100) : 0,
        };
      }),
    },
  };
}

/** The portfolio's live figures, the ones Showcase control can replace, over the last 30 days. */
export function liveFigures(today: TodayBlock, units: ShowcaseUnit[], ins: Insights): Live {
  return {
    today_in: today.checkIns.count, today_out: today.checkOuts.count, today_up: today.upcoming.count,
    tn_occ: today.tonight.occupied, tn_pct: today.tonight.pct, tn_turn: today.tonight.turnovers, listings: units.length,
    rev_count: ins.reviews.count, rev_five: ins.reviews.fiveStar, rev_rating: ins.reviews.rating,
    occ_rate: ins.occupancy.rate, occ_cancel: ins.occupancy.cancel, occ_stay: ins.occupancy.avgStay, occ_year: ins.occupancy.year,
    lead_avg: ins.lead.avg, lead_b0: ins.lead.buckets[0], lead_b1: ins.lead.buckets[1], lead_b2: ins.lead.buckets[2], lead_b3: ins.lead.buckets[3], lead_b4: ins.lead.buckets[4],
    views_pv: null, views_imp: null,
  };
}

export interface CalendarStay { id: string; code: string; unitId: string; guest: string; checkIn: string; checkOut: string; guests: number; status: 'completed' | 'in_stay' | 'confirmed'; total: number }

/** Stays and nightly Airbnb prices of listed units (or one) for `days` nights from `from`. A night's price is the one
 *  set for it, else the standard Airbnb price (functions/_lib/channelPrice.ts), as Pricing and the Calendar show. */
export async function calendar(env: Env, units: ShowcaseUnit[], from: string, days: number) {
  const end = addDays(from, days), last = addDays(from, days - 1), today = todayMyt();
  const ids = JSON.stringify(units.map(u => u.id));
  const IN = `IN (SELECT jsonb_array_elements_text(?::text::jsonb))`;
  const [stays, base, rates, uplifts] = await Promise.all([
    all<any>(env, `
      SELECT r.id, r.unit_id, r.external_ref, r.check_in, r.check_out, r.guests_count, r.gross_booking_value, g.full_name
      FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
      WHERE ${COUNTED_STAY} AND r.unit_id ${IN} AND r.check_in < ? AND r.check_out > ? ORDER BY r.check_in`, ids, end, from),
    all<{ id: string; base_rate: number; weekend_rate: number | null }>(env, `SELECT id, base_rate, weekend_rate FROM units WHERE id ${IN}`, ids),
    all<{ unit_id: string; rate_date: string; rate: number }>(env, `SELECT unit_id, rate_date, rate FROM channel_rates WHERE channel = 'airbnb' AND unit_id ${IN} AND rate_date BETWEEN ? AND ?`, ids, from, last),
    all<{ unit_id: string; uplift: number }>(env, `SELECT unit_id, uplift FROM channel_uplifts WHERE channel = 'airbnb' AND unit_id ${IN}`, ids),
  ]);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const set = new Map(rates.map(r => [`${r.unit_id}|${r.rate_date}`, Number(r.rate)]));
  const upl = new Map(uplifts.map(u => [u.unit_id, Number(u.uplift)]));
  const priced = new Map(base.map(b => [b.id, dates.map(d => set.get(`${b.id}|${d}`) ?? standardRate('airbnb', Number(b.base_rate), b.weekend_rate, upl.get(b.id), d))]));
  return {
    from, days, today, dates,
    rates: Object.fromEntries(units.map(u => [u.id, priced.get(u.id) ?? dates.map(() => 0)])),
    stays: stays.map((r): CalendarStay => ({
      id: r.id, code: String(r.external_ref || r.id.replace(/[^A-Za-z0-9]/g, '').slice(-8)).toUpperCase(), unitId: r.unit_id,
      guest: maskGuest(r.full_name), checkIn: r.check_in, checkOut: r.check_out, guests: Number(r.guests_count ?? 1),
      status: r.check_out <= today ? 'completed' : r.check_in <= today ? 'in_stay' : 'confirmed', total: Number(r.gross_booking_value ?? 0),
    })),
  };
}
