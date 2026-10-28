import { type Env, all, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { loadInputs, computeMonthsWithYearToDate, statementSettings, hasActivity, type Query } from '../../_lib/ownerStatement';
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

  // The months shown and the three before them: the "own past" check compares each month with the three before it.
  const lookBack = [shift(from, -3), shift(from, -2), shift(from, -1)];
  const all6 = [...lookBack, ...list];
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const settings = await statementSettings(q);
  const inputs = await loadInputs(q, `${all6[0]}-01`, monthEndExclusive(to));
  const computed = await computeMonthsWithYearToDate(q, inputs, all6, settings);
  const unitOf = new Map(inputs.units.map(u => [u.id, u]));
  // What guests paid, by reservation: the same reservations the statement counts, grouped by unit.
  const stays = new Map<string, { id: string; check_in: string; check_out: string; gross_booking_value: number }[]>();
  for (const s of await all<{ id: string; unit_id: string; check_in: string; check_out: string; gross_booking_value: number }>(env, `
    SELECT id, unit_id, check_in, check_out, gross_booking_value FROM reservations
    WHERE state IN ('confirmed','checked_in','checked_out') AND channel NOT IN ('maintenance_block','owner_stay')
      AND check_in < ? AND check_out > ?`, monthEndExclusive(to), `${all6[0]}-01`)) stays.set(s.unit_id, [...(stays.get(s.unit_id) ?? []), s]);

  // Electricity bills kept for the records only, so a settled month with one is not reported as missing it.
  const recordOnly = new Map((await all<{ unit_id: string; month: string; amount: number }>(env, `
    SELECT unit_id, substr(incurred_on, 1, 7) AS month, sum(amount)::int AS amount FROM expenses
    WHERE record_only AND category = 'electricity' AND incurred_on >= ? AND incurred_on < ? GROUP BY 1, 2`, `${all6[0]}-01`, monthEndExclusive(to)))
    .map(x => [`${x.unit_id}|${x.month}`, Number(x.amount)]));

  const units = new Map<string, { id: string; building: string; number: string; owner: string; contract: 'LT' | 'PS' }>();
  const rows: UnitMonthInput[] = [];
  const active = new Set<string>();
  let excluded = 0;
  for (const month of all6) {
    for (const m of computed.get(month) ?? []) {
      const lt = m.terms.basis === 'fixed_rent';
      if (!lt && (m.terms.basis !== 'share' || isTenancy(m.terms.model))) { if (month === to && hasActivity(m)) excluded++; continue; }
      if (hasActivity(m)) active.add(m.unitId);
      const u = unitOf.get(m.unitId)!;
      const sum = (pick: (c: string) => boolean) => m.deductionGroups.filter(g => pick(g.category)).reduce((n, g) => n + g.amount, 0);
      // The statement's own income for each reservation this month: it stands in where a reservation has no guest total.
      const stmt = new Map<string, number>();
      for (const l of m.lines) if (l.type === 'gross' && l.reservationId) stmt.set(l.reservationId, (stmt.get(l.reservationId) ?? 0) + l.amount);
      let guestPaid = 0, guestPaidMissing = false;
      for (const s of stays.get(m.unitId) ?? []) {
        const paid = Number(s.gross_booking_value) || 0;
        if (paid) guestPaid += spreadGuestPaid(String(s.check_in), String(s.check_out), paid, month);
        else if (stmt.get(s.id)) { guestPaid += stmt.get(s.id)!; guestPaidMissing = true; }
      }
      if (list.includes(month)) units.set(m.unitId, { id: m.unitId, building: u.property_name, number: u.unit_number, owner: u.owner_name, contract: lt ? 'LT' : 'PS' });
      rows.push({
        unitId: m.unitId, month, contract: lt ? 'LT' : 'PS', guestPaid, guestPaidMissing, gross: m.gross,
        cleaning: sum(c => c.startsWith('cleaning')), electricity: sum(c => c === 'electricity'), water: sum(c => c === 'water'),
        internet: sum(c => c === 'internet'), sewerage: sum(c => c === 'sewerage'), other: sum(c => c === 'additional'), misc: sum(c => c === 'misc'),
        ownerPct: lt ? 0 : m.terms.ownerPct ?? 0,
        // A yearly guarantee is checked once a year, not month by month (as the Overall unit report).
        ltGrr: lt ? m.fixedRent : m.terms.model === 'management_guarantee' ? m.guarantee : 0,
        nights: m.nights, days: m.days, recordOnlyElectricity: recordOnly.get(`${m.unitId}|${month}`) ?? 0,
      });
    }
  }
  // A unit is listed when it had anything in the range (its empty months then show as gaps); one idle throughout is not.
  const shownUnits = new Set([...active].filter(id => units.has(id)));
  const inRange = (r: UnitMonthInput) => shownUnits.has(r.unitId);
  const saved = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', LIMITS_KEY);
  let limits: Limits = { lines: {} };
  try {
    const v = saved?.value ? JSON.parse(saved.value) : null;
    if (v && typeof v === 'object') limits = { lines: v.lines && typeof v.lines === 'object' ? v.lines : {}, ...(typeof v.marginMin === 'number' ? { marginMin: v.marginMin } : {}) };
  } catch { /* a bad value reads as no limits */ }
  return json({
    generatedAt: nowIso(), months: list, units: [...units.values()].filter(u => shownUnits.has(u.id)).sort((a, b) => a.building.localeCompare(b.building) || a.number.localeCompare(b.number, 'en', { numeric: true })),
    rows: rows.filter(r => inRange(r) && list.includes(r.month)), lookBack: rows.filter(r => inRange(r) && !list.includes(r.month)), limits, excluded, toDate: list.includes(thisMonth) ? thisMonth : null,
  });
};
