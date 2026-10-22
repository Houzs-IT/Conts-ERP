/** The overall owner report (the owner workbook's overall report sheet): every derived figure of one unit's month, worked out in
 *  one place so the table, the totals, the KPI strip and the drawer never recompute anything themselves. Amounts are
 *  in sen. Checked against all 114 rows of the September 2026 sheet.
 *
 *    total deduction = cleaning + utilities + additional + misc
 *    GP              = revenue - total deduction
 *    PS: O1 = GP x owner %, owner base = the higher of O1 and GRR
 *    LT: owner base = LT (owner % and O1 unused)
 *    owner payout    = owner base + O2
 *    gain/loss       = GP - owner base (O2 is passed straight to the owner and does not change it) */

export type Contract = 'LT' | 'PS';

export interface OverallInput {
  contract: Contract;
  revenue: number; cleaning: number; utilities: number; additional: number; misc: number;
  /** The utilities total split by bill; sewerage is Indah Water. */
  electricity: number; water: number; internet: number; sewerage: number;
  /** PS only: the owner's percentage of GP (80 for 80%). */
  ownerPct: number;
  /** LT: the fixed monthly rent. PS: the monthly guaranteed minimum (GRR), 0 when there is none. */
  ltGrr: number;
  o2: number;
  nights: number; days: number;
}

export interface OverallFigures extends OverallInput {
  deductions: number; gp: number; o1: number; ownerBase: number; payout: number; gainLoss: number;
  /** Percent, 0-100. */
  occupancy: number;
  revPerNight: number;
  /** Percent of revenue; 0 when there is no revenue. */
  margin: number;
  /** The revenue at which gain/loss would be zero. */
  breakEven: number;
}

/** To the sen, halves away from zero (as the statements round: 2,647.45 x 85% = 2,250.33). */
const roundSen = (x: number): number => Math.sign(x) * Math.round(Number(Math.abs(x).toFixed(6)));

export function overallFigures(i: OverallInput): OverallFigures {
  const deductions = i.cleaning + i.utilities + i.additional + i.misc;
  const gp = i.revenue - deductions;
  const o1 = i.contract === 'PS' ? roundSen((gp * i.ownerPct) / 100) : 0;
  const ownerBase = i.contract === 'PS' ? Math.max(o1, i.ltGrr) : i.ltGrr;
  return {
    ...i, deductions, gp, o1, ownerBase,
    payout: ownerBase + i.o2,
    gainLoss: gp - ownerBase,
    occupancy: i.days ? (i.nights / i.days) * 100 : 0,
    revPerNight: i.nights ? Math.round(i.revenue / i.nights) : 0,
    margin: i.revenue ? (gp / i.revenue) * 100 : 0,
    breakEven: deductions + i.ltGrr,
  };
}

/** The columns that add up across units. */
export const SUMMED = ['revenue', 'cleaning', 'utilities', 'electricity', 'water', 'internet', 'sewerage', 'additional', 'misc', 'deductions', 'gp', 'ltGrr', 'o1', 'o2',
  'ownerBase', 'payout', 'gainLoss', 'breakEven', 'nights', 'days'] as const;
export type Summed = typeof SUMMED[number];

export interface OverallTotals extends Record<Summed, number> {
  units: number; losing: number;
  /** Booked nights over available nights, not an average of the units' percentages. */
  occupancy: number; revPerNight: number; margin: number;
}

export function overallTotals(rows: readonly OverallFigures[]): OverallTotals {
  const t = Object.fromEntries(SUMMED.map(k => [k, rows.reduce((n, r) => n + r[k], 0)])) as Record<Summed, number>;
  return {
    ...t, units: rows.length, losing: rows.filter(r => r.gainLoss < 0).length,
    occupancy: t.days ? (t.nights / t.days) * 100 : 0,
    revPerNight: t.nights ? Math.round(t.revenue / t.nights) : 0,
    margin: t.revenue ? (t.gp / t.revenue) * 100 : 0,
  };
}
