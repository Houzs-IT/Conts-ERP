import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

const KL_TODAY = `to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;

function monthsBack(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const daysIn = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** GET /api/dashboard/trend?range=3m|12m|ytd — revenue and occupancy per month. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const range = new URL(request.url).searchParams.get('range') ?? '12m';
  if (!['3m', '12m', 'ytd'].includes(range)) return fail('VALIDATION', 'Range must be 3m, 12m or ytd.', 422);

  const today = (await one<{ d: string }>(env, `SELECT ${KL_TODAY} AS d`))!.d;
  const current = today.slice(0, 7);
  const count = range === '3m' ? 3 : range === '12m' ? 12 : Number(today.slice(5, 7));
  const periods = monthsBack(today, count);

  const rows = await all<{ period: string; gross: number; revenue: number; nights: number }>(env, `
    SELECT substr(check_in, 1, 7) AS period,
           COALESCE(SUM(gross_booking_value), 0) AS gross,
           COALESCE(SUM(collected_revenue), 0) AS revenue,
           COALESCE(SUM(check_out::date - check_in::date), 0) AS nights
    FROM reservations
    WHERE state IN ('confirmed','checked_in','checked_out')
      AND channel NOT IN ('maintenance_block','owner_stay')
      AND substr(check_in, 1, 7) BETWEEN ? AND ?
    GROUP BY period`, periods[0], periods[periods.length - 1]);
  const byPeriod = new Map(rows.map(r => [r.period, r]));

  const listed = (await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE is_listed = 1'))!.n;
  const finance = canSeeFinance(session.role);

  const points = periods.map(p => {
    const r = byPeriod.get(p);
    const available = listed * daysIn(p);
    return {
      period: p,
      revenue: finance ? Number(r?.revenue ?? 0) : 0,
      occupancy: available ? Math.min(100, Number((((r?.nights ?? 0) / available) * 100).toFixed(1))) : 0,
      isCurrent: p === current,
    };
  });

  const fees = await one<{ fee: number; net: number }>(env, `
    SELECT COALESCE(SUM(management_fee), 0) AS fee, COALESCE(SUM(net_payout), 0) AS net
    FROM owner_statements WHERE substr(period_start, 1, 7) BETWEEN ? AND ?`, periods[0], current);

  const sum = (k: 'gross' | 'revenue') => periods.reduce((n, p) => n + Number(byPeriod.get(p)?.[k] ?? 0), 0);
  const last = points[points.length - 1]?.revenue ?? 0;
  const prev = points.length > 1 ? points[points.length - 2].revenue : 0;
  const pct = prev > 0 ? Number((((last - prev) / prev) * 100).toFixed(1)) : 0;

  return json({
    generatedAt: new Date().toISOString(),
    currency: 'MYR',
    points,
    totals: finance
      ? { grossBookingValue: sum('gross'), collectedRevenue: sum('revenue'), managementFees: Number(fees?.fee ?? 0), netOwnerPayout: Number(fees?.net ?? 0) }
      : { grossBookingValue: 0, collectedRevenue: 0, managementFees: 0, netOwnerPayout: 0 },
    delta: { value: Math.abs(pct), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', tone: pct > 0 ? 'success' : 'neutral' },
  });
};
