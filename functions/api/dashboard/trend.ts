import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { monthsBack, daysIn } from '../../_lib/ops';
import { stayMonths, metrics, groupBy, monthEndExclusive } from '../../_lib/revenue';

const KL_TODAY = `to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;

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

  // functions/_lib/revenue.ts: each stay's gross value and nights split by night into the months it covers.
  const rows = await stayMonths(env, `${periods[0]}-01`, monthEndExclusive(periods[periods.length - 1]));
  const listedIds = new Set((await all<{ id: string }>(env, 'SELECT id FROM units WHERE is_listed = 1')).map(u => u.id));
  const byPeriod = groupBy(rows, r => r.month);
  const finance = session.manage;

  const points = periods.map(p => {
    const list = byPeriod.get(p) ?? [];
    const occ = metrics(list.filter(r => listedIds.has(r.unit_id)), listedIds.size * daysIn(p));
    return { period: p, revenue: finance ? metrics(list, 0).gross : 0, occupancy: occ.occupancy, isCurrent: p === current };
  });

  const fees = await one<{ fee: number; net: number }>(env, `
    SELECT COALESCE(SUM(management_fee), 0) AS fee, COALESCE(SUM(net_payout), 0) AS net
    FROM owner_statements WHERE substr(period_start, 1, 7) BETWEEN ? AND ?`, periods[0], current);

  const sum = (k: 'gross' | 'collected') => Math.round(rows.reduce((n, r) => n + r[k], 0));
  const last = points[points.length - 1]?.revenue ?? 0;
  const prev = points.length > 1 ? points[points.length - 2].revenue : 0;
  const pct = prev > 0 ? Number((((last - prev) / prev) * 100).toFixed(1)) : 0;

  return json({
    generatedAt: new Date().toISOString(),
    currency: 'MYR',
    points,
    totals: finance
      ? { grossBookingValue: sum('gross'), collectedRevenue: sum('collected'), managementFees: Number(fees?.fee ?? 0), netOwnerPayout: Number(fees?.net ?? 0) }
      : { grossBookingValue: 0, collectedRevenue: 0, managementFees: 0, netOwnerPayout: 0 },
    delta: { value: Math.abs(pct), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', tone: pct > 0 ? 'success' : 'neutral' },
  });
};
