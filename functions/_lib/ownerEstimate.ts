import { type Env, all } from './db';
import { loadInputs, computeMonthsWithYearToDate, statementSettings, type Query } from './ownerStatement';
import { monthEndExclusive } from './revenue';

export interface OwnerMonthTotals {
  /** Gross Income as the owner statements count it (income split by night into the month). */
  income: number;
  /** Costs the owners pay, deducted before the split. */
  ownerCosts: number;
  /** What The Conts keeps: the management share, or for fixed rent the net income less the rent. */
  operatorShare: number;
  /** What the owners are paid: share, minimum top-ups, fixed rent and Owner Adjustments. */
  netPayout: number;
}

/**
 * The owners' side of whole months, worked out by the owner statement engine exactly as the Owners page does
 * (functions/api/owners/index.ts), so the Dashboard and the Owners page give the same "To pay owners" figure. Until a
 * month's statement is final these are estimates. Income less owner costs equals operator share plus the owners'
 * payout before Owner Adjustments and minimum top-ups.
 */
export async function ownerMonths(env: Env, months: string[]): Promise<Map<string, OwnerMonthTotals>> {
  return ownerMonthsFor((sql, ...args) => all(env, sql, ...args), months);
}

/** ownerMonths on any query function (scripts/api-checks/owner-months.mjs counts its queries). */
export async function ownerMonthsFor(q: Query, months: string[]): Promise<Map<string, OwnerMonthTotals>> {
  const out = new Map<string, OwnerMonthTotals>();
  if (!months.length) return out;
  const sorted = [...months].sort();
  const [settings, inputs] = await Promise.all([
    statementSettings(q), loadInputs(q, `${sorted[0]}-01`, monthEndExclusive(sorted[sorted.length - 1])),
  ]);
  for (const [month, rows] of await computeMonthsWithYearToDate(q, inputs, sorted, settings)) {
    out.set(month, rows.reduce((t, m) => ({
      income: t.income + m.gross, ownerCosts: t.ownerCosts + m.deductions,
      operatorShare: t.operatorShare + m.operatorShare, netPayout: t.netPayout + m.netPayout,
    }), { income: 0, ownerCosts: 0, operatorShare: 0, netPayout: 0 }));
  }
  return out;
}
