import { type Env, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { monthsBack } from '../../_lib/ops';
import { stayMonths, activeMetrics, dashboardUnits, liveWindows, groupBy, monthEndExclusive } from '../../_lib/revenue';
import { ownerMonths } from '../../_lib/ownerEstimate';
import { scopeCached } from '../../_lib/scopeCache';

/** GET /api/dashboard/trend?range=3m|12m|ytd|next — reservation income and occupancy per month (next: this month and the
 *  five after it, from the reservations already taken). Worked out at most once a minute per
 *  scope (functions/_lib/scopeCache.ts), like the tiles: it runs the statement engine over every month of the range. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const range = new URL(request.url).searchParams.get('range') ?? '12m';
  if (!['3m', '12m', 'ytd', 'next'].includes(range)) return fail('VALIDATION', 'Range must be 3m, 12m, ytd or next.', 422);

  const finance = session.manage || can(session, 'finance', 'view');
  const scope = `dashboard/trend|${range}|${mytToday()}|${finance ? 'money' : 'occupancy'}`;
  return json(await scopeCached(env, request, scope, () => trend(env, range, finance), { waitUntil }));
};

async function trend(env: Env, range: string, finance: boolean) {
  const today = mytToday();
  const current = today.slice(0, 7);
  const count = range === '3m' ? 3 : range === '12m' ? 12 : Number(today.slice(5, 7));
  // Upcoming: this month and the five after it (the last of six months back from five months ahead).
  const ahead = (n: number) => { const [y, m] = today.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 10); };
  const periods = range === 'next' ? monthsBack(ahead(5), 6) : monthsBack(today, count);

  // functions/_lib/revenue.ts: each stay's income and nights split by night into the months it covers, over rental
  // units without rent to rent; a month counts the units live in it by the share of the month (owner, 19 Nov 2026).
  const [allRows, counted, live, ownerByMonth] = await Promise.all([
    stayMonths(env, `${periods[0]}-01`, monthEndExclusive(periods[periods.length - 1])),
    dashboardUnits(env), liveWindows(env, today),
    finance && range !== 'next' ? ownerMonths(env, periods) : Promise.resolve(new Map<string, never>()),
  ]);
  const rows = counted ? allRows.filter(r => counted.has(r.unit_id)) : allRows;
  const byPeriod = groupBy(rows, r => r.month);

  const points = periods.map(p => {
    const a = activeMetrics(byPeriod.get(p) ?? [], `${p}-01`, monthEndExclusive(p), live, counted);
    return { period: p, revenue: finance ? a.gross : 0, occupancy: a.occupancy, activeUnits: a.activeUnits, perUnit: finance ? a.perUnit : 0,
      isCurrent: p === current, isFuture: p > current };
  });

  // Operator share and owner payout for every month of the range by the statement engine (the Owners page's figures).
  // They used to sum only the stored statements, so months without one counted nothing and the four totals could not
  // be read together. Income less owner costs = operator share + owner payout before adjustments and top-ups.
  const owners = [...ownerByMonth.values()];
  const ownerSum = (k: 'income' | 'ownerCosts' | 'operatorShare' | 'netPayout') => Math.round(owners.reduce((n, m) => n + m[k], 0));

  const sum = (k: 'gross' | 'collected') => Math.round(rows.reduce((n, r) => n + r[k], 0));
  // The month in progress is only part-way, so set against a whole month it always reads as a fall. The
  // change compares the last two complete months instead, and says which.
  const complete = points.filter(p => !p.isCurrent && !p.isFuture);
  const lastP = complete[complete.length - 1], prevP = complete[complete.length - 2];
  const last = lastP?.revenue ?? 0, prev = prevP?.revenue ?? 0;
  const pct = prev > 0 ? Number((((last - prev) / prev) * 100).toFixed(1)) : 0;

  return {
    generatedAt: new Date().toISOString(),
    currency: 'MYR',
    points,
    totals: finance
      ? { grossBookingValue: sum('gross'), collectedRevenue: sum('collected'), statementIncome: ownerSum('income'), ownerCosts: ownerSum('ownerCosts'),
          managementFees: ownerSum('operatorShare'), netOwnerPayout: ownerSum('netPayout'), estimate: true }
      : { grossBookingValue: 0, collectedRevenue: 0, statementIncome: 0, ownerCosts: 0, managementFees: 0, netOwnerPayout: 0, estimate: false },
    delta: {
      value: Math.abs(pct), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', tone: pct > 0 ? 'success' : 'neutral',
      ...(lastP && prevP ? { period: lastP.period, against: prevP.period } : {}),
    },
  };
}
