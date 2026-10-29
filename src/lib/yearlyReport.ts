/** The yearly unit report (PLAN-yearly-report.md): the staff sheet "REPORT JAN-DEC", one grid per figure with units down
 *  and months across. Every figure follows the Overall unit report's rule (ownerOverall.ts overallFigures; the test checks
 *  they agree, as unitPnl.ts does, so this file stays loadable by node); the only extra is what we pay cleaners.
 *  Amounts are sen. */

export interface YearlyRow {
  unitId: string; month: string; contract: 'LT' | 'PS';
  revenue: number; cleaning: number; electricity: number; water: number; internet: number; sewerage: number;
  additional: number; misc: number; ownerPct: number; ltGrr: number; o2: number; nights: number; days: number;
  /** What The Conts paid cleaners for the cleans finished on the unit that month. */
  cleanerCost: number;
}

/** Choices the owner has not made yet (29 Oct 2026); each is one switch here, and the page says which are on. */
export interface ReportRules {
  /** Owner payout counts the owner's credits and charges (O2), as the Overall unit report column does. */
  ownerPayoutIncludesO2: boolean;
  /** Fixed-rent (LT) units charge the owner for cleaning. Off: the company carries it, so the owner is charged nothing. */
  ltOwnerPaysCleaning: boolean;
}
export const REPORT_RULES: ReportRules = { ownerPayoutIncludesO2: true, ltOwnerPaysCleaning: false };

/** The sheet's order. */
export const BLOCKS = [
  { key: 'revenue', label: 'Earnings' },
  { key: 'gp', label: 'Gross profit' },
  { key: 'payout', label: 'Owner payout' },
  { key: 'company', label: 'The Conts' },
  { key: 'electricity', label: 'Electric' },
  { key: 'water', label: 'Water' },
  { key: 'sewerage', label: 'Indah Water' },
  { key: 'internet', label: 'Wi-Fi' },
  { key: 'cleanerCost', label: 'Cleaning: cleaner charges The Conts' },
  { key: 'cleaningOwner', label: 'Cleaning: The Conts charges owner' },
  { key: 'cleaningEarned', label: 'Cleaning: what we earn' },
] as const;
export type BlockKey = typeof BLOCKS[number]['key'];
export type Figures = Record<BlockKey, number>;

/** To the sen, halves away from zero (ownerOverall.ts roundSen). */
const roundSen = (x: number): number => Math.sign(x) * Math.round(Number(Math.abs(x).toFixed(6)));

export function figures(r: YearlyRow, rules: ReportRules = REPORT_RULES): Figures {
  const utilities = r.electricity + r.water + r.internet + r.sewerage;
  const gp = r.revenue - (r.cleaning + utilities + r.additional + r.misc);
  const ownerBase = r.contract === 'PS' ? Math.max(roundSen((gp * r.ownerPct) / 100), r.ltGrr) : r.ltGrr;
  const cleaning = r.contract === 'LT' && !rules.ltOwnerPaysCleaning ? 0 : r.cleaning;
  return {
    revenue: r.revenue, gp, payout: ownerBase + (rules.ownerPayoutIncludesO2 ? r.o2 : 0), company: gp - ownerBase,
    electricity: r.electricity, water: r.water, sewerage: r.sewerage, internet: r.internet,
    cleanerCost: r.cleanerCost, cleaningOwner: cleaning, cleaningEarned: cleaning - r.cleanerCost,
  };
}

/** A month cell is null when the unit has no figures that month (it shows as a dash, not as a zero). */
export type Cells = (number | null)[];
export interface BlockGrid { key: BlockKey; label: string; units: Record<string, Cells>; totals: Cells }

const add = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
/** The Total column: months added up, null when the unit has nothing in any month. */
export const rowTotal = (cells: Cells): number | null => cells.reduce<number | null>(add, null);

/** One grid per block over the given months (12 for a year). A unit with no row in a month is null there. */
export function pivot(rows: readonly YearlyRow[], months: readonly string[], rules: ReportRules = REPORT_RULES): BlockGrid[] {
  const col = new Map(months.map((m, i) => [m, i]));
  const grids: BlockGrid[] = BLOCKS.map(b => ({ key: b.key, label: b.label, units: {}, totals: months.map(() => null) }));
  for (const r of rows) {
    const i = col.get(r.month);
    if (i === undefined) continue;
    const f = figures(r, rules);
    for (const g of grids) {
      const cells = (g.units[r.unitId] ??= months.map(() => null));
      cells[i] = add(cells[i] ?? null, f[g.key]);
      g.totals[i] = add(g.totals[i] ?? null, f[g.key]);
    }
  }
  return grids;
}
