import { type Env, all, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { loadInputs, withYearToDate, computeMonth, statementSettings, hasActivity, type Query } from '../../_lib/ownerStatement';
import { isTenancy } from '../../_lib/revenueModel';
import { monthEndExclusive } from '../../_lib/revenue';
import { spreadGuestPaid, type Limits, type UnitMonthInput } from '../../../src/lib/unitPnl';

/** GET /api/finance/unit-pnl?from=YYYY-MM&to=YYYY-MM — the unit P&L report (plan
 *  docs/superpowers/plans/2026-10-28-unit-pnl.md). For each month, the owner statement engine's figures for every
 *  profit-share and fixed-rent unit (as GET /api/portfolio/owner-report, so the two agree), plus what guests paid for
 *  the month's nights (reservations.gross_booking_value spread by night). Only inputs are sent; every line, layer,
 *  check and gap is worked out by src/lib/unitPnl.ts. Up to 12 months; default the six months before this one. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const shift = (m: string, by: number) => { const n = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + by; return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`; };
export const LIMITS_KEY = 'report.unitPnlLimits';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'This report is available to finance and management.', 403);
  const url = new URL(request.url);
  const thisMonth = todayMyt().slice(0, 7);
  const to = url.searchParams.get('to') || shift(thisMonth, -1);
  const from = url.searchParams.get('from') || shift(to, -5);
  if (!MONTH.test(from) || !MONTH.test(to)) return fail('VALIDATION', 'Months must look like 2026-09.', 422);
  if (from > to) return fail('VALIDATION', 'The first month must come before the last.', 422);
  const list: string[] = [];
  for (let m = from; m <= to; m = shift(m, 1)) list.push(m);
  if (list.length > 12) return fail('VALIDATION', 'Choose up to 12 months.', 422);

  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const settings = await statementSettings(q);
  // What guests paid, by stay: the same stays the statement counts.
  const stays = await all<{ unit_id: string; check_in: string; check_out: string; gross_booking_value: number; collected_revenue: number }>(env, `
    SELECT unit_id, check_in, check_out, gross_booking_value, collected_revenue FROM reservations
    WHERE state IN ('confirmed','checked_in','checked_out') AND channel NOT IN ('maintenance_block','owner_stay')
      AND check_in < ? AND check_out > ?`, monthEndExclusive(to), `${from}-01`);

  const units = new Map<string, { id: string; building: string; number: string; owner: string; contract: 'LT' | 'PS' }>();
  const rows: UnitMonthInput[] = [];
  let excluded = 0;
  for (const month of list) {
    const inputs = await loadInputs(q, `${month}-01`, monthEndExclusive(month));
    const months = computeMonth(month, await withYearToDate(q, inputs, month, settings), settings, 'dated').filter(hasActivity);
    const unitOf = new Map(inputs.units.map(u => [u.id, u]));
    for (const m of months) {
      const lt = m.terms.basis === 'fixed_rent';
      if (!lt && (m.terms.basis !== 'share' || isTenancy(m.terms.model))) { if (month === to) excluded++; continue; }
      const u = unitOf.get(m.unitId)!;
      const sum = (pick: (c: string) => boolean) => m.deductionGroups.filter(g => pick(g.category)).reduce((n, g) => n + g.amount, 0);
      let guestPaid = 0, guestPaidMissing = false;
      for (const s of stays) if (s.unit_id === m.unitId) {
        const paid = Number(s.gross_booking_value) || 0;
        const share = spreadGuestPaid(String(s.check_in), String(s.check_out), paid || Number(s.collected_revenue) || 0, month);
        if (share && !paid) guestPaidMissing = true;
        guestPaid += share;
      }
      units.set(m.unitId, { id: m.unitId, building: u.property_name, number: u.unit_number, owner: u.owner_name, contract: lt ? 'LT' : 'PS' });
      rows.push({
        unitId: m.unitId, month, contract: lt ? 'LT' : 'PS', guestPaid, guestPaidMissing, gross: m.gross,
        cleaning: sum(c => c.startsWith('cleaning')), electricity: sum(c => c === 'electricity'), water: sum(c => c === 'water'),
        internet: sum(c => c === 'internet'), sewerage: sum(c => c === 'sewerage'), other: sum(c => c === 'additional'), misc: sum(c => c === 'misc'),
        ownerPct: lt ? 0 : m.terms.ownerPct ?? 0,
        // A yearly guarantee is checked once a year, not month by month (as the Overall unit report).
        ltGrr: lt ? m.fixedRent : m.terms.model === 'management_guarantee' ? m.guarantee : 0,
        nights: m.nights, days: m.days,
      });
    }
  }
  const saved = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', LIMITS_KEY);
  let limits: Limits = { lines: {} };
  try { if (saved?.value) limits = { lines: {}, ...JSON.parse(saved.value) }; } catch { /* a bad value reads as no limits */ }
  return json({
    generatedAt: nowIso(), months: list, units: [...units.values()].sort((a, b) => a.building.localeCompare(b.building) || a.number.localeCompare(b.number, 'en', { numeric: true })),
    rows, limits, excluded, toDate: list.includes(thisMonth) ? thisMonth : null,
  });
};
