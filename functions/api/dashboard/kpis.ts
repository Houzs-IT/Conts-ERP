import { type Env, json, fail, mytToday } from '../../_lib/db';
import { stayMonths, metrics, activeMetrics, dashboardUnits, liveWindows, monthEndExclusive, toDate } from '../../_lib/revenue';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { ownerMonths } from '../../_lib/ownerEstimate';
import { scopeCached } from '../../_lib/scopeCache';

/** GET /api/dashboard/kpis — the month's tiles. The same for everyone who sees the same figures, so it is worked out
 *  at most once a minute per scope (functions/_lib/scopeCache.ts); `cachedAt` says when, and `generatedAt` (the
 *  dashboard's "Last updated") is that same moment. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const period = url.searchParams.get('period') ?? mytToday().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);
  const money = session.manage || can(session, 'finance', 'view');
  // Everything the answer depends on: the month, today (the month in progress stops at today), and whether the money
  // tiles are in it.
  const scope = `dashboard/kpis|${period}|${mytToday()}|${money ? 'money' : 'occupancy'}`;
  return json(await scopeCached(env, request, scope, () => kpis(env, period, money), { waitUntil }));
};

async function kpis(env: Env, period: string, money: boolean) {

  // functions/_lib/revenue.ts: income and nights split by night into the month, to date like Portfolio (the month in
  // progress stops at today), over rental units without rent to rent. Occupancy and income per available night are over
  // the units live in it, each by the days it was live (owner, 19 Nov 2026).
  const { toExclusive } = toDate(`${period}-01`, monthEndExclusive(period), mytToday());
  const [allRows, counted, live, ownerByMonth] = await Promise.all([
    stayMonths(env, `${period}-01`, toExclusive),
    dashboardUnits(env), liveWindows(env, mytToday()),
    money ? ownerMonths(env, [period]) : Promise.resolve(undefined),
  ]);
  const rows = counted ? allRows.filter(r => counted.has(r.unit_id)) : allRows;
  const active = activeMetrics(rows, `${period}-01`, toExclusive, live, counted);
  const listed = metrics(rows, active.liveDays);
  const everything = metrics(rows, 0);
  // The owners' payout for the whole month by the statement engine, the same estimate as the Owners page's "To pay
  // owners" (stored statements only exist once a month is generated, so they read RM 0 for the month in progress).
  const owners = ownerByMonth?.get(period);

  const kpis = [
    { key: 'occupancy', value: listed.occupancy.toFixed(1), unit: 'percent' },
    ...(money ? [
      { key: 'accommodation_revenue', value: everything.gross, currency: 'MYR' },
      { key: 'income_per_unit', value: active.perUnit, currency: 'MYR', units: active.activeUnits },
      { key: 'adr', value: listed.adr, currency: 'MYR' },
      { key: 'revpar', value: listed.revpar, currency: 'MYR' },
      { key: 'net_owner_payout', value: owners?.netPayout ?? 0, currency: 'MYR', estimate: true },
    ] : []),
  ];

  return { generatedAt: new Date().toISOString(), period, kpis };
}
