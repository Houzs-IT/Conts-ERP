/** Revenue and occupancy, defined once (owner ruling, Oct 2026):
 *   - a stay's money and nights are split by night into the period they fall in (a 7-night stay from
 *     31 Jul counts 1 night and 1/7 of its value in July, 6 nights and 6/7 in August);
 *   - revenue is the GROSS booking value (what the guest paid, before the booking site's fee);
 *   - occupancy = booked nights / nights available in the period (the workbook's "29 nights = 96.67%" is
 *     29 / 30 days of September);
 *   - maintenance blocks, owner stays and cancelled bookings are not revenue and not booked nights.
 *  ADR = gross / booked nights; RevPAR = gross / available nights.
 *  Owner statements use the same night split (functions/_lib/ownerStatement.ts) but on what the booking
 *  site paid out (collected revenue), because that is what the owner workbook calls Hospitality Income. */
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
/** The share of a stay's amount that belongs to `nights` of its `total` nights. Not rounded: callers round once. */
export const prorate = (amount: number, nights: number, total: number) => (total > 0 ? (amount * nights) / total : 0);

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
      SELECT m.month, r.unit_id, r.channel, r.gross_booking_value, r.collected_revenue,
             (r.check_out::date - r.check_in::date) AS total,
             (LEAST(r.check_out::date, m.me) - GREATEST(r.check_in::date, m.mf)) AS nights
      FROM reservations r JOIN m ON r.check_in::date < m.me AND r.check_out::date > m.mf
      ${opts.listedOnly ? 'JOIN units lu ON lu.id = r.unit_id AND lu.is_listed = 1' : ''}
      WHERE ${COUNTED_STAY} AND r.check_in < ? AND r.check_out > ? ${opts.unitId ? 'AND r.unit_id = ?' : ''}
    )
    SELECT month, unit_id, channel, SUM(nights)::int AS nights,
           COALESCE(SUM(gross_booking_value::numeric * nights / NULLIF(total, 0)), 0)::float8 AS gross,
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
