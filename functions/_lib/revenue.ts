/** Revenue and occupancy, defined once (owner ruling, Oct 2026):
 *   - a stay's money and nights are split by night into the period they fall in (a 7-night stay from
 *     31 Jul counts 1 night and 1/7 of its value in July, 6 nights and 6/7 in August);
 *   - revenue is what the stay brings in, the same number the owner statement and the Unit report use (owner, 19 Nov
 *     2026, replacing the gross booking value): from October 2026 the host payout (after the booking site's fee), else
 *     the payout recorded against the stay; `gross` keeps its name for the callers;
 *   - occupancy = booked nights / nights available in the period (the workbook's "29 nights = 96.67%" is
 *     29 / 30 days of September);
 *   - maintenance blocks, owner stays and cancelled bookings are not revenue and not booked nights.
 *  ADR = gross / booked nights; RevPAR = gross / available nights.
 *  Owner statements use the same night split and the same money (functions/_lib/ownerStatement.ts stayIncomeParts). */
import { type Env, all } from './db';

/** SQL condition for a stay that counts, on reservations aliased `r`. */
export const COUNTED_STAY = `r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay')`;

const DAY = 864e5;
const t = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
/** Nights between two YYYY-MM-DD dates. */
export const nightsBetween = (from: string, to: string) => Math.max(0, Math.round((t(to) - t(from)) / DAY));
/** Nights of a stay [checkIn, checkOut) that fall in [from, toExclusive). */
export const nightsInWindow = (checkIn: string, checkOut: string, from: string, toExclusive: string) =>
  nightsBetween(checkIn > from ? checkIn : from, checkOut < toExclusive ? checkOut : toExclusive);
/** First day after a YYYY-MM month, and its number of days. */
export const monthEndExclusive = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
/** A period counted to date (owner ruling, 11 Oct 2026): a month or quarter still in progress stops at the end of
 *  today, so occupancy is nights booked so far over nights available so far; a finished period is counted whole.
 *  Returns the exclusive end and the days in [from, end). */
export function toDate(from: string, periodEndExclusive: string, today: string) {
  const tomorrow = new Date(t(today) + DAY).toISOString().slice(0, 10);
  const toExclusive = tomorrow > from && tomorrow < periodEndExclusive ? tomorrow : periodEndExclusive;
  return { toExclusive, days: Math.max(1, nightsBetween(from, toExclusive)) };
}
/** The share of a stay's amount that belongs to `nights` of its `total` nights. Not rounded: callers round once. */
export const prorate = (amount: number, nights: number, total: number) => (total > 0 ? (amount * nights) / total : 0);

/** From this month on, a stay's income is its host payout as the calendar shows it (owner, 3 Nov 2026), not the payout
 *  recorded later. Earlier months keep the recorded payout, so they still agree with the owner workbook. */
export const NET_INCOME_FROM = '2026-10';

export interface StayMonthRow { month: string; unit_id: string; channel: string; nights: number; gross: number; collected: number }

/** Booked nights, gross and collected revenue per month, unit and channel for stays overlapping
 *  [from, toExclusive), each stay split by night into the months it covers (amounts in sen, not rounded). */
export async function stayMonths(env: Env, from: string, toExclusive: string, opts: { unitId?: string; listedOnly?: boolean } = {}): Promise<StayMonthRow[]> {
  const args: unknown[] = [toExclusive, from, from, toExclusive, toExclusive, from];
  if (opts.unitId) args.push(opts.unitId);
  const rows = await all<StayMonthRow>(env, `
    WITH m AS (
      SELECT LEAST((d + interval '1 month')::date, ?::date) AS me, GREATEST(d::date, ?::date) AS mf, to_char(d, 'YYYY-MM') AS month
      FROM generate_series(date_trunc('month', ?::timestamp), ?::timestamp - interval '1 day', interval '1 month') AS d
    ), s AS (
      SELECT m.month, r.unit_id, r.channel, r.collected_revenue,
             -- The host payout as ownerStatement.ts loadInputs reads it: the booking value less the site's fee.
             CASE WHEN m.month >= '${NET_INCOME_FROM}' AND r.gross_booking_value - COALESCE(r.channel_fee, 0) > 0
               THEN r.gross_booking_value - COALESCE(r.channel_fee, 0) ELSE r.collected_revenue END AS income,
             (r.check_out::date - r.check_in::date) AS total,
             (LEAST(r.check_out::date, m.me) - GREATEST(r.check_in::date, m.mf)) AS nights
      FROM reservations r JOIN m ON r.check_in::date < m.me AND r.check_out::date > m.mf
      ${opts.listedOnly ? 'JOIN units lu ON lu.id = r.unit_id AND lu.is_listed = 1' : ''}
      WHERE ${COUNTED_STAY} AND r.check_in < ? AND r.check_out > ? ${opts.unitId ? 'AND r.unit_id = ?' : ''}
    )
    SELECT month, unit_id, channel, SUM(nights)::int AS nights,
           COALESCE(SUM(income::numeric * nights / NULLIF(total, 0)), 0)::float8 AS gross,
           COALESCE(SUM(collected_revenue::numeric * nights / NULLIF(total, 0)), 0)::float8 AS collected
    FROM s WHERE nights > 0 GROUP BY month, unit_id, channel`, ...args);
  return rows.map(r => ({ ...r, nights: Number(r.nights), gross: Number(r.gross), collected: Number(r.collected) }));
}

export interface Metrics { nights: number; gross: number; collected: number; available: number; occupancy: number; adr: number; revpar: number }

/** Sums rows (any grouping) into the standard metrics. Money in whole sen; occupancy in percent, one decimal, at most 100. */
export function metrics(rows: Pick<StayMonthRow, 'nights' | 'gross' | 'collected'>[], availableNights: number): Metrics {
  const nights = rows.reduce((n, r) => n + r.nights, 0);
  const grossExact = rows.reduce((n, r) => n + r.gross, 0);
  const gross = Math.round(grossExact), collected = Math.round(rows.reduce((n, r) => n + r.collected, 0));
  return {
    nights, gross, collected, available: availableNights,
    occupancy: availableNights ? Math.min(100, Number(((nights / availableNights) * 100).toFixed(1))) : 0,
    adr: nights ? Math.round(grossExact / nights) : 0,
    revpar: availableNights ? Math.round(grossExact / availableNights) : 0,
  };
}

/** Rows grouped by a key. */
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const list = m.get(k); if (list) list.push(r); else m.set(k, [r]); }
  return m;
}

/** The units the dashboard counts (owner, 19 Nov 2026): rental units, without rent to rent (its income is the tenant's
 *  rent, not stays). Null on a database without the purpose or contract columns: every unit counts. */
export async function dashboardUnits(env: Env): Promise<Set<string> | null> {
  try {
    const rows = await all<{ id: string }>(env, `SELECT u.id FROM units u LEFT JOIN owner_contracts c ON c.id = u.contract_id
      WHERE COALESCE(u.purpose, 'rental') = 'rental' AND COALESCE(c.revenue_model, '') <> 'master_lease'`);
    return new Set(rows.map(r => r.id));
  } catch { return null; }
}

/** When each unit is live (owner, 19 Nov 2026): from its first reservation's check-in to its last reservation's
 *  checkout; a unit still trading (a stay ending in the last 30 days, or one to come) stays live past today. */
export type LiveWindows = Map<string, { from: string; toExclusive: string }>;
export async function liveWindows(env: Env, today: string, farFuture = '2100-01-01'): Promise<LiveWindows> {
  const rows = await all<{ unit_id: string; first_in: string; last_out: string }>(env, `
    SELECT r.unit_id, MIN(r.check_in)::date::text AS first_in, MAX(r.check_out)::date::text AS last_out
    FROM reservations r WHERE ${COUNTED_STAY} GROUP BY r.unit_id`);
  const recent = new Date(t(today) - 30 * DAY).toISOString().slice(0, 10);
  return new Map(rows.map(r => [r.unit_id, { from: r.first_in.slice(0, 10), toExclusive: r.last_out.slice(0, 10) >= recent ? farFuture : r.last_out.slice(0, 10) }]));
}

/** A month's figures over the units live in it (owner, 19 Nov 2026): a unit live from the 1st to the 14th counts as one
 *  unit, one that goes live on the 15th or later as half a unit; likewise one whose last checkout falls on or before the
 *  15th is half. Occupancy = booked nights / (units x days); income per unit = the month's income / units. */
export interface ActiveMetrics { activeUnits: number; liveDays: number; nights: number; gross: number; occupancy: number; perUnit: number }
export function activeMetrics(rows: Pick<StayMonthRow, 'unit_id' | 'nights' | 'gross'>[], from: string, toExclusive: string, live: LiveWindows, units: Set<string> | null): ActiveMetrics {
  const periodDays = nightsBetween(from, toExclusive);
  const mid = `${from.slice(0, 7)}-15`;
  let count = 0;
  for (const [id, w] of live) {
    if (units && !units.has(id)) continue;
    if (!nightsInWindow(w.from, w.toExclusive, from, toExclusive)) continue;
    count += w.from >= mid || w.toExclusive <= mid ? 0.5 : 1;
  }
  const nights = rows.reduce((n, r) => n + r.nights, 0);
  const grossExact = rows.reduce((n, r) => n + r.gross, 0);
  const liveDays = count * periodDays;
  return {
    activeUnits: count, liveDays, nights, gross: Math.round(grossExact),
    occupancy: liveDays ? Math.min(100, Number(((nights / liveDays) * 100).toFixed(1))) : 0,
    perUnit: count ? Math.round(grossExact / count) : 0,
  };
}
