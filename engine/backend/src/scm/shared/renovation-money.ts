/* Renovation document money: line amounts, the SO mirror row, document totals,
   quantity labels for print, and progress-billing instalment amounts.

   ONE definition shared by the sales documents (phase 2, server and screens) and
   the project module (phase 3). Mirrored byte-for-byte at
   frontend/src/vendor/shared/renovation-money.ts; renovation-shared.canonical.test.ts
   enforces it.

   All money is integer sen. A measure is integer thousandths of its unit
   (42.6 FT = 42600), so no floating point ever reaches a stored amount.

   Rules (owner defaults, integration contract):
   - amount = measure x rate when a measure is set, else qty x rate;
   - a line discount % is applied per line and the result rounded to the sen;
   - a typed amount override replaces the computed net amount and is flagged;
   - FOC lines keep their list amount for print but charge nothing;
   - waived lines are simply negative rates;
   - lines in a lump-sum section are not priced one by one: the section price is. */

import { uomPrintLabel } from './renovation-catalog';

export const MEASURE_SCALE = 1000;
export const BP_SCALE = 10000;

export type RenoLineKind = 'ITEM' | 'CHILD' | 'DETAIL' | 'TEXT';
export const RENO_LINE_KINDS: readonly RenoLineKind[] = ['ITEM', 'CHILD', 'DETAIL', 'TEXT'];
export const PRICED_KINDS: readonly RenoLineKind[] = ['ITEM', 'CHILD'];

/** Integer division rounded half away from zero (so -2.5 sen -> -3, 2.5 -> 3). */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return NaN;
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((n * 2 + d) / (d * 2));
}

/** "42.6" -> 42600. Blank -> null. Negative, more than 3 decimals or junk -> NaN. */
export function parseMeasureMilli(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (s === '') return null;
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * MEASURE_SCALE + Number((frac + '000').slice(0, 3));
}

/** 42600 -> "42.6", 20000 -> "20", 10380 -> "10.38". */
export function formatMeasure(milli: number): string {
  const whole = Math.trunc(milli / MEASURE_SCALE);
  const frac = String(Math.abs(milli % MEASURE_SCALE)).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** 149100 -> "1,491.00"; -4000 -> "-40.00". */
export function formatRm(sen: number, opts: { grouping?: boolean; trimZeros?: boolean } = {}): string {
  const neg = sen < 0;
  const abs = Math.abs(Math.round(sen));
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const w = opts.grouping === false ? String(whole) : whole.toLocaleString('en-US');
  const body = opts.trimZeros && cents === '00' ? w : `${w}.${cents}`;
  return `${neg ? '-' : ''}${body}`;
}

export interface MoneyLine {
  kind: RenoLineKind;
  qty: number;
  measureMilli: number | null;
  measureUom: string | null;
  uom?: string | null;
  unitPriceSen: number;
  discountBp: number;
  amountOverrideSen: number | null;
  isFoc: boolean;
}

export interface LineAmounts {
  /** List amount before the line discount (what format 3 prints as Amount). */
  baseSen: number;
  /** What the customer pays for this line. */
  netSen: number;
  /** base - net: line discount, FOC, or the override's difference. */
  discountSen: number;
  overridden: boolean;
  priced: boolean;
}

const isPricedKind = (k: RenoLineKind) => k === 'ITEM' || k === 'CHILD';

export function lineAmounts(l: MoneyLine): LineAmounts {
  if (!isPricedKind(l.kind)) return { baseSen: 0, netSen: 0, discountSen: 0, overridden: false, priced: false };
  const baseSen = l.measureMilli !== null
    ? roundDiv(l.measureMilli * l.unitPriceSen, MEASURE_SCALE)
    : l.qty * l.unitPriceSen;
  let netSen = roundDiv(baseSen * (BP_SCALE - (l.discountBp || 0)), BP_SCALE);
  let overridden = false;
  if (l.isFoc) netSen = 0;
  else if (l.amountOverrideSen !== null && l.amountOverrideSen !== undefined) {
    overridden = l.amountOverrideSen !== netSen;
    netSen = l.amountOverrideSen;
  }
  return { baseSen, netSen, discountSen: baseSen - netSen, overridden, priced: true };
}

export interface SoMirrorRow {
  qty: number;
  unit_price_sen: number;
  discount_sen: number;
  total_sen: number;
  description2: string | null;
  uom: string;
}

/** The mfg_sales_order_items row a priced line becomes. Invariant on every row:
    total_sen = qty x unit_price_sen - discount_sen. `inLumpSum` lines carry no
    price (the section's own row does). */
export function soMirrorRow(l: MoneyLine, opts: { inLumpSum?: boolean } = {}): SoMirrorRow {
  const uom = String(l.measureUom ?? l.uom ?? 'UNIT').toUpperCase();
  if (opts.inLumpSum) {
    return { qty: Math.max(l.qty, 1), unit_price_sen: 0, discount_sen: 0, total_sen: 0, description2: null, uom };
  }
  const a = lineAmounts(l);
  if (l.measureMilli !== null) {
    const description2 = `${formatMeasure(l.measureMilli)} ${uomPrintLabel(uom)} @ RM${formatRm(l.unitPriceSen, { grouping: false })}`;
    return { qty: 1, unit_price_sen: a.baseSen, discount_sen: a.discountSen, total_sen: a.netSen, description2, uom };
  }
  return { qty: l.qty, unit_price_sen: l.unitPriceSen, discount_sen: l.qty * l.unitPriceSen - a.netSen, total_sen: a.netSen, description2: null, uom };
}

/** What a line costs us (PO amount): cost is per the same unit as the rate,
    so a measured line costs measure x unit cost. Lump-sum section lines keep
    their own cost: the PO still buys them. */
export function lineCostSen(l: Pick<MoneyLine, 'kind' | 'qty' | 'measureMilli'> & { unitCostSen: number }): number {
  if (!isPricedKind(l.kind)) return 0;
  return l.measureMilli !== null ? roundDiv(l.measureMilli * l.unitCostSen, MEASURE_SCALE) : l.qty * l.unitCostSen;
}

/** What the Qty column prints: "42.6FT", "LS", "1 SET", "FULL UNIT", "3". */
export function qtyLabel(l: Pick<MoneyLine, 'qty' | 'measureMilli' | 'measureUom' | 'uom'>): string {
  const uom = String(l.measureUom ?? l.uom ?? '').toUpperCase();
  if (l.measureMilli !== null && l.measureMilli !== undefined) return `${formatMeasure(l.measureMilli)}${uomPrintLabel(uom || 'FT')}`;
  if (uom === 'LOT') return 'LS';
  if (uom === 'FULL') return 'FULL UNIT';
  if (uom === 'SET') return `${l.qty} SET`;
  return String(l.qty);
}

export interface TotalsSection {
  lumpSumSen: number | null;
  lines: MoneyLine[];
}

export interface DocTotals {
  /** Sum of list amounts (format 3's TOTAL). Lump-sum sections count at their price. */
  listSen: number;
  /** Sum of what is charged per line, before the document discount. */
  netSen: number;
  docDiscountSen: number;
  /** What the customer pays: net - document discount. */
  finalSen: number;
  /** list - final: format 3's DISCOUNT row. */
  totalDiscountSen: number;
  overriddenLines: number;
}

export function docTotals(sections: TotalsSection[], docDiscountSen = 0): DocTotals {
  let listSen = 0;
  let netSen = 0;
  let overriddenLines = 0;
  for (const s of sections) {
    if (s.lumpSumSen !== null && s.lumpSumSen !== undefined) {
      listSen += s.lumpSumSen;
      netSen += s.lumpSumSen;
      continue;
    }
    for (const l of s.lines) {
      const a = lineAmounts(l);
      listSen += a.baseSen;
      netSen += a.netSen;
      if (a.overridden) overriddenLines += 1;
    }
  }
  const finalSen = netSen - docDiscountSen;
  return { listSen, netSen, docDiscountSen, finalSen, totalDiscountSen: listSen - finalSen, overriddenLines };
}

export interface InstalmentPct {
  seq: number;
  pctBp: number;
}

/** A payment schedule must add up to exactly 100%. */
export function instalmentPctError(rows: InstalmentPct[]): string | null {
  if (rows.length === 0) return 'A payment schedule needs at least one instalment.';
  if (rows.some((r) => !Number.isInteger(r.pctBp) || r.pctBp <= 0)) return 'Every instalment needs a percentage above 0.';
  const seqs = new Set(rows.map((r) => r.seq));
  if (seqs.size !== rows.length) return 'Two instalments share one number.';
  const sum = rows.reduce((s, r) => s + r.pctBp, 0);
  if (sum !== BP_SCALE) return `The instalments add up to ${sum / 100}%, not 100%.`;
  return null;
}

export interface NextInstalmentInput {
  /** The whole schedule, any order. */
  instalments: InstalmentPct[];
  /** The instalment being billed: must be the lowest one not yet billed. */
  seq: number;
  /** Contract sum after every approved VO. */
  revisedContractSen: number;
  /** Sum of everything already billed on this contract (credit notes negative). */
  billedSen: number;
}

export interface NextInstalmentResult {
  cumBp: number;
  /** Cumulative amount that should have been billed after this instalment. */
  targetSen: number;
  /** What this instalment bills now; negative means a credit note. */
  amountSen: number;
  isLast: boolean;
}

/** Instalment amount = cumulative % x revised contract sum - already billed.
    The last instalment bills the exact remainder, so rounding never leaves a
    sen behind. 100k on 15/50/30/5 with VO +10k after #2: #3 = 39,500, #4 = 5,500. */
export function nextInstalmentAmount(p: NextInstalmentInput): NextInstalmentResult {
  const rows = [...p.instalments].sort((a, b) => a.seq - b.seq);
  const idx = rows.findIndex((r) => r.seq === p.seq);
  if (idx < 0) throw new Error(`instalment ${p.seq} is not on this schedule`);
  const cumBp = rows.slice(0, idx + 1).reduce((s, r) => s + r.pctBp, 0);
  const isLast = idx === rows.length - 1;
  const targetSen = isLast ? p.revisedContractSen : roundDiv(p.revisedContractSen * cumBp, BP_SCALE);
  return { cumBp, targetSen, amountSen: targetSen - p.billedSen, isLast };
}

/** Amounts for every instalment as if nothing changes from here on. `creditedSen`: what contract credit notes took
    back (they lower the revised contract and what is billed, so later instalments are worked out net). */
export function instalmentPreview(instalments: InstalmentPct[], revisedContractSen: number, billed: ReadonlyMap<number, number>, creditedSen = 0): Array<{ seq: number; amountSen: number; billed: boolean }> {
  const rows = [...instalments].sort((a, b) => a.seq - b.seq);
  let billedSen = -creditedSen;
  const out: Array<{ seq: number; amountSen: number; billed: boolean }> = [];
  for (const r of rows) {
    const done = billed.get(r.seq);
    if (done !== undefined) {
      billedSen += done;
      out.push({ seq: r.seq, amountSen: done, billed: true });
      continue;
    }
    const n = nextInstalmentAmount({ instalments: rows, seq: r.seq, revisedContractSen, billedSen });
    billedSen += n.amountSen;
    out.push({ seq: r.seq, amountSen: n.amountSen, billed: false });
  }
  return out;
}

/** A PO instalment's amount: percentage of the PO total, the last one taking the remainder. */
export function poInstalmentAmounts(pcts: number[], poTotalSen: number): number[] {
  let used = 0;
  return pcts.map((bp, i) => {
    if (i === pcts.length - 1) return poTotalSen - used;
    const a = roundDiv(poTotalSen * bp, BP_SCALE);
    used += a;
    return a;
  });
}
