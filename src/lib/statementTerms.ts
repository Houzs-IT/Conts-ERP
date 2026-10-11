/** The words an owner sees for money, one set everywhere: the owner's own Owner Income Report (the printed two-page
 *  report the company sends every month) is the source. Owner portal, statement screens, statement PDFs, the report,
 *  the owner profile and the unit P&L all label owner money from here, and the statement generator and the workbook
 *  import write these words into statement_lines. Shared by the app and functions/ (like phone.ts). */

export const TERMS = {
  grossIncome: 'Gross Income',
  hospitalityIncome: 'Hospitality Income',
  monthlyRent: 'Monthly Rent',
  expenseDeduction: 'Expense Deduction',
  totalDeduction: 'Total Deduction',
  /** The report's line in full; `netIncome` is its short form (the year-to-date page's column). */
  netIncomeFull: 'Net Income Before Deduct Management Fees',
  netIncome: 'Net Income',
  toOperator: 'To Operator',
  fixedRent: 'Fixed Rent',
  topUp: 'Minimum Guarantee Top-up',
  /** A month imported from the owner workbook where the company paid more than the unit made, on a fixed-rent unit. */
  fixedRentTopUp: 'Fixed Rent Top-up',
  payoutBeforeAdjustment: 'Payout Before O2 Adjustment',
  adjustments: 'Owner Adjustments',
  netPayout: 'Net Payout to Owner',
  /** A month paid before Property OS with no breakdown: only what was paid is known. */
  payout: 'Payout to Owner',
  /** Year-to-date page columns. */
  ytdGross: 'Gross Income',
  ytdExpense: 'Expense Deduction',
  ytdGrossDeduction: 'Gross Deduction',
  ytdNet: 'Net Income',
} as const;

/** The report's deduction rows, in its order: [category, label, unit of measure]. */
export const DEDUCTION_TERMS = [
  ['cleaning_basic', 'Basic Cleaning Fee', 'sessions'],
  ['cleaning_deep', 'Deep Cleaning Fee', 'sessions'],
  ['electricity', 'Electricity Usage', 'months'],
  ['water', 'Water Usage', 'months'],
  ['internet', 'Wi-Fi Subscription Fee', 'months'],
  ['sewerage', 'IndahWater Usage', 'tasks'],
  ['additional', 'Additional Deduction', 'tasks'],
  ['misc', 'Miscellaneous Charges', 'services'],
] as const;

/** Deduction categories outside the report's rows: months imported from the owner workbook carry cleaning and
 *  utilities as one figure each. */
const OTHER_DEDUCTIONS: Record<string, string> = {
  cleaning: 'Cleaning Fee', housekeeping: 'Cleaning Fee', utilities: 'Utilities', other: 'Additional Deduction', maintenance: 'Additional Deduction',
};

const pctText = (p: number) => `${Number(p.toFixed(2))}%`;

/** "15% To Operator"; just "To Operator" when the percentage is not known or differs between units. */
export const toOperator = (operatorPct?: number | null) => (operatorPct == null ? TERMS.toOperator : `${pctText(operatorPct)} ${TERMS.toOperator}`);

export function deductionTerm(category: string | null | undefined, description?: string | null): string {
  const hit = DEDUCTION_TERMS.find(d => d[0] === category);
  if (hit) return hit[1];
  if (category === 'other' && /miscellaneous/i.test(description ?? '')) return 'Miscellaneous Charges';
  return OTHER_DEDUCTIONS[category ?? 'other'] ?? 'Additional Deduction';
}

/** Words a statement line used to carry that are not for the owner: the import's source tag and the unit name
 *  glued to the front ("Regalia A33A-09 (1): Utilities (owner workbook)"). */
const SOURCE_TAG = /\s*\((?:owner workbook)(?:, no breakdown)?\)\s*$/i;
export const isSourceReference = (ref: string | null | undefined) => !!ref && /^owner workbook$/i.test(ref.trim());

export interface TermLine { line_type: string; category: string | null; description: string | null }

/** What a statement line is called, from what it is (type and category), never from free text that may carry the
 *  unit or the import's wording. Owner credits and charges keep their own words ("Maintenance fee Sep 26"). */
export function lineTerm(l: TermLine): string {
  const d = String(l.description ?? '');
  switch (l.line_type) {
    case 'gross': return l.category === 'long_term_rent' ? TERMS.monthlyRent : TERMS.hospitalityIncome;
    case 'expense': return deductionTerm(l.category, d);
    case 'management_fee': {
      const m = /(\d+(?:\.\d+)?)%/.exec(d);
      return toOperator(m ? Number(m[1]) : null);
    }
    case 'adjustment':
      if (l.category === 'guarantee_top_up') return TERMS.topUp;
      if (l.category === 'fixed_rent') return TERMS.fixedRent;
      if (l.category === 'workbook_payout') return /fixed rent top-up/i.test(d) ? TERMS.fixedRentTopUp : /top-up/i.test(d) ? TERMS.topUp : TERMS.payout;
      return d.replace(/^O2:\s*/i, '') || 'Adjustment';
    default: return d;
  }
}

/** The second line under a term, when there is one worth showing: the stay (guest and dates) under Hospitality
 *  Income, the expense's own text under a deduction. Never the unit name (statements group by unit) or the import's tags. */
export function lineDetail(l: TermLine & { unitLabel?: string | null }): string | null {
  if (l.line_type === 'management_fee' || l.line_type === 'adjustment') return null;
  let d = String(l.description ?? '').trim();
  if (!d || SOURCE_TAG.test(d)) return null;
  if (l.unitLabel) {
    for (const sep of [' · ', ': ']) if (d.startsWith(`${l.unitLabel}${sep}`)) d = d.slice(l.unitLabel.length + sep.length);
  }
  const term = lineTerm(l);
  if (d.toLowerCase().startsWith(`${term.toLowerCase()} · `)) d = d.slice(term.length + 3);
  if (!d || d.toLowerCase() === term.toLowerCase() || /^miscellaneous charges/i.test(d) || /^monthly rent$/i.test(d)) return null;
  return d;
}

export interface SummaryRow { label: string; amount: number; type: 'gross' | 'expense' | 'subtotal' | 'fee' | 'adjustment' | 'net' }

/** A statement as the report reads it, top to bottom: Gross Income, each deduction, Net Income, To Operator, any
 *  top-up or fixed rent, Payout Before O2 Adjustment and the owner's credits and charges when there are any, and
 *  Net Payout to Owner. Lines of every unit are added together; a breakdown by unit is the caller's. */
export function summaryRows(lines: (TermLine & { amount: number | string })[], netPayout: number): SummaryRow[] {
  const sum = (ls: { amount: number | string }[]) => ls.reduce((n, l) => n + Number(l.amount), 0);
  const grouped = (ls: (TermLine & { amount: number | string })[]) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(lineTerm(l), (m.get(lineTerm(l)) ?? 0) + Number(l.amount));
    return [...m.entries()];
  };
  const gross = lines.filter(l => l.line_type === 'gross');
  const costs = lines.filter(l => l.line_type === 'expense');
  const fees = lines.filter(l => l.line_type === 'management_fee');
  const contract = lines.filter(l => l.line_type === 'adjustment' && ['guarantee_top_up', 'fixed_rent', 'workbook_payout'].includes(l.category ?? ''));
  const owner = lines.filter(l => l.line_type === 'adjustment' && !contract.includes(l));
  const rows: SummaryRow[] = [];
  const grossTotal = sum(gross), costTotal = sum(costs);
  if (gross.length) rows.push({ label: TERMS.grossIncome, amount: grossTotal, type: 'gross' });
  for (const [label, amount] of grouped(costs)) rows.push({ label, amount, type: 'expense' });
  if (gross.length && costs.length) rows.push({ label: TERMS.netIncome, amount: grossTotal + costTotal, type: 'subtotal' });
  if (fees.length) {
    const terms = [...new Set(fees.map(lineTerm))];
    rows.push({ label: terms.length === 1 ? terms[0] : TERMS.toOperator, amount: sum(fees), type: 'fee' });
  }
  for (const [label, amount] of grouped(contract)) rows.push({ label, amount, type: 'adjustment' });
  if (owner.length) {
    if (rows.length) rows.push({ label: TERMS.payoutBeforeAdjustment, amount: netPayout - sum(owner), type: 'subtotal' });
    for (const [label, amount] of grouped(owner)) rows.push({ label, amount, type: 'adjustment' });
  }
  rows.push({ label: TERMS.netPayout, amount: netPayout, type: 'net' });
  return rows;
}
