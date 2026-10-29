import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { todayMyt, MYT_DATE } from '../../_lib/ops';
import { loadInputs, computeMonthsWithYearToDate, statementSettings, hasActivity, type Query } from '../../_lib/ownerStatement';
import { isTenancy } from '../../_lib/revenueModel';
import { monthEndExclusive } from '../../_lib/revenue';
import { taskCleanersReady } from '../../_lib/taskCleaners';
import { hasCleanPrices, priceBook, layoutKey } from '../../_lib/cleaningPrices';
import { CLEAN_KINDS_SQL } from '../../_lib/cleaning';
import type { YearlyRow } from '../../../src/lib/yearlyReport';

/** GET /api/reports/yearly?year=2026 — the yearly unit report (PLAN-yearly-report.md): for every profit-share and
 *  fixed-rent unit, each month's figures from the statement engine (as GET /api/portfolio/owner-report, so the two agree)
 *  plus what The Conts paid cleaners for the cleans finished on the unit that month (as GET /api/housekeeping/pay).
 *  Only inputs are sent; every block, total and difference is worked out by src/lib/yearlyReport.ts. */
const YEAR = /^\d{4}$/;
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'This report is available to finance and management.', 403);
  const thisYear = todayMyt().slice(0, 4);
  const year = new URL(request.url).searchParams.get('year') || thisYear;
  if (!YEAR.test(year) || Number(year) < 2020 || Number(year) > Number(thisYear)) return fail('VALIDATION', `Choose a year from 2020 to ${thisYear}.`, 422);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const settings = await statementSettings(q);
  const inputs = await loadInputs(q, `${year}-01-01`, monthEndExclusive(`${year}-12`));
  const computed = await computeMonthsWithYearToDate(q, inputs, months, settings);
  const unitOf = new Map(inputs.units.map(u => [u.id, u]));

  // Cleans finished on our units, in Malaysian time, that a cleaner did: the pay screen's own set and price rule.
  const cost = new Map<string, number>();
  let unpricedCleans = 0;
  if (await hasCleanPrices(env)) {
    const team = (await taskCleanersReady(env)) ? 'EXISTS (SELECT 1 FROM task_cleaners tc WHERE tc.task_id = t.id AND tc.cleaner_id IS NOT NULL)' : 'FALSE';
    const layout = (await hasColumn(env, 'units', 'layout_type').catch(() => false)) ? 'u.layout_type' : 'NULL::text';
    const jobs = await all<{ unit_id: string; kind: string; cleaner_pay: number | null; month: string; day_at: string; bedrooms: number | null; layout_type: string | null }>(env, `
      SELECT t.unit_id, t.kind, t.cleaner_pay, substr(${MYT_DATE('t.completed_at')}, 1, 7) AS month, COALESCE(t.scheduled_for, t.due_at, t.created_at) AS day_at,
             u.bedrooms, ${layout} AS layout_type
      FROM tasks t JOIN units u ON u.id = t.unit_id
      WHERE t.kind IN ${CLEAN_KINDS_SQL} AND t.state = 'resolved' AND t.completed_at IS NOT NULL AND (t.cleaner_id IS NOT NULL OR ${team})
        AND substr(${MYT_DATE('t.completed_at')}, 1, 4) = ?`, year);
    const price = await priceBook(env, [...new Set(jobs.map(j => j.unit_id))]);
    for (const j of jobs) {
      const pay = j.cleaner_pay ?? price(j.unit_id, j.kind, layoutKey(j.layout_type, j.bedrooms), j.day_at).internal;
      if (pay == null) { unpricedCleans++; continue; }
      cost.set(`${j.unit_id}|${j.month}`, (cost.get(`${j.unit_id}|${j.month}`) ?? 0) + Number(pay));
    }
  }

  const units = new Map<string, { id: string; building: string; number: string; owner: string; contract: 'LT' | 'PS' }>();
  const rows: YearlyRow[] = [];
  const excludedUnits = new Set<string>();
  const used = new Set<string>();
  for (const month of months) {
    for (const m of computed.get(month) ?? []) {
      if (!hasActivity(m)) continue;
      const lt = m.terms.basis === 'fixed_rent';
      if (!lt && (m.terms.basis !== 'share' || isTenancy(m.terms.model))) { excludedUnits.add(m.unitId); continue; }
      const u = unitOf.get(m.unitId)!;
      const sum = (pick: (category: string) => boolean) => m.deductionGroups.filter(g => pick(g.category)).reduce((n, g) => n + g.amount, 0);
      const contract = lt ? 'LT' : 'PS';
      units.set(m.unitId, { id: m.unitId, building: u.property_name, number: u.unit_number, owner: u.owner_name, contract });
      used.add(`${m.unitId}|${month}`);
      rows.push({
        unitId: m.unitId, month, contract, revenue: m.gross, cleaning: sum(c => c.startsWith('cleaning')),
        electricity: sum(c => c === 'electricity'), water: sum(c => c === 'water'), internet: sum(c => c === 'internet'), sewerage: sum(c => c === 'sewerage'),
        additional: sum(c => c === 'additional'), misc: sum(c => c === 'misc'), ownerPct: lt ? 0 : m.terms.ownerPct ?? 0,
        // A yearly guarantee is checked once a year, not month by month (as the Overall unit report).
        ltGrr: lt ? m.fixedRent : m.terms.model === 'management_guarantee' ? m.guarantee : 0,
        o2: m.adjustmentsTotal, nights: m.nights, days: m.days, cleanerCost: cost.get(`${m.unitId}|${month}`) ?? 0,
      });
    }
  }
  // Cleaner pay on a unit and month the grid does not list (a lease, or a month with no statement figures): shown beside it.
  let notInGrid = 0;
  for (const [k, v] of cost) if (!used.has(k)) notInGrid += v;
  return json({
    generatedAt: nowIso(), year, months, rows, notInGrid, unpricedCleans, excluded: excludedUnits.size,
    toDate: year === thisYear ? todayMyt().slice(0, 7) : null,
    units: [...units.values()].sort((a, b) => a.building.localeCompare(b.building) || a.number.localeCompare(b.number, 'en', { numeric: true })),
  });
};
