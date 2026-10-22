import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { loadInputs, withYearToDate, computeMonth, statementSettings, hasActivity, type Query } from '../../_lib/ownerStatement';
import { unitCode } from '../../_lib/ownerReport';
import { monthEndExclusive } from '../../_lib/revenue';

const UTILITIES = new Set(['electricity', 'water', 'internet', 'sewerage']);

/** GET /api/portfolio/owner-report?month=2026-09 — the overall owner report (the owner workbook's overall report sheet): one row
 *  per unit with figures that month, worked out by the statement engine (ownerStatement.ts), so it agrees with the
 *  owner statements. Only the inputs are sent; every derived column comes from src/lib/ownerOverall.ts.
 *  LT is a fixed-rent (GRR) unit, PS a profit-share one; long-term lets and master leases are counted, not listed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'This report is available to finance and management.', 403);

  const month = new URL(request.url).searchParams.get('month') || todayMyt().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-09.', 422);

  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const [settings, inputs] = await Promise.all([statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month))]);
  const months = computeMonth(month, await withYearToDate(q, inputs, month, settings), settings, 'dated').filter(hasActivity);
  const unitOf = new Map(inputs.units.map(u => [u.id, u]));

  let excluded = 0;
  const rows = months.flatMap(m => {
    const lt = m.terms.basis === 'fixed_rent';
    if (!lt && (m.terms.basis !== 'share' || m.terms.model === 'long_term')) { excluded++; return []; }
    const u = unitOf.get(m.unitId)!;
    const sum = (pick: (category: string) => boolean) => m.deductionGroups.filter(g => pick(g.category)).reduce((n, g) => n + g.amount, 0);
    return [{
      unitId: m.unitId, code: u.unit_code || unitCode(u.property_name, u.unit_number), building: u.property_name, ownerName: u.owner_name,
      contract: lt ? 'LT' : 'PS', revenue: m.gross,
      cleaning: sum(c => c.startsWith('cleaning')), utilities: sum(c => UTILITIES.has(c)), additional: sum(c => c === 'additional'), misc: sum(c => c === 'misc'),
      ownerPct: lt ? 0 : m.terms.ownerPct ?? 0,
      // A yearly guarantee is checked once a year (its true-up lands on the statement as a top-up), not month by month.
      ltGrr: lt ? m.fixedRent : m.terms.model === 'management_guarantee' ? m.guarantee : 0,
      o2: m.adjustmentsTotal, nights: m.nights, days: m.days,
    }];
  });
  return json({ generatedAt: nowIso(), month, excluded, rows });
};
