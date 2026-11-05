/** The utility listing's rules (plan docs/superpowers/plans/2026-10-28-utility-listing.md, spec 2026-10-27 §7): a bill's
 *  state, the unit × kind × month cells, per-unit averages and the unusual bills. Amounts in sen; months YYYY-MM. */

export type UtilityKind = 'electricity' | 'water' | 'internet' | 'sewerage';
export const KINDS: UtilityKind[] = ['electricity', 'water', 'internet', 'sewerage'];
export const KIND_LABEL: Record<UtilityKind, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'IWK' };

/** charged: on a final owner statement · pending: the owner pays, not charged yet · company: the company pays ·
 *  record: kept for the records only (the 2026 backfill of settled months). Words and colours: STATUS_VOCAB.utility_bill. */
export type BillState = 'charged' | 'pending' | 'company' | 'record';

export interface GridBill {
  id: string; unitId: string; kind: UtilityKind;
  /** The month the bill is for (its incurred_on), and the month of the owner statement that deducts it. */
  billMonth: string; deductMonth: string;
  amount: number; chargeTo: string; recordOnly: boolean;
  /** The deduction month's owner statement is final (finalised, sent or paid). */
  final: boolean;
  receiptId: string | null; reference: string | null; rolled: boolean;
  /** The payment request the bill went out on: its number, engine status, the month (MYT) it was made, and what it asks
   *  for the bill (the whole printed bill, also when the expense keeps only the days inside the contract). */
  request?: { id: string; no: string | null; status: string; month: string; amount?: number } | null;
}

/** The "By payment request" view (chew, 5 Nov 2026; SOP 3.10): waiting for payment, part paid, paid. A rejected or
 *  withdrawn request no longer asks for the money, so its bills are not shown. Words and colours: STATUS_VOCAB.utility_request. */
export type RequestState = 'waiting' | 'part_paid' | 'paid';
export function requestState(status: string): RequestState | null {
  if (status === 'SUBMITTED') return 'waiting';
  if (status === 'PART_PAID') return 'part_paid';
  if (status === 'PAID' || status === 'CLOSED') return 'paid';
  return null;
}
const REQUEST_ORDER: RequestState[] = ['waiting', 'part_paid', 'paid'];

export function billState(b: GridBill): BillState {
  if (b.recordOnly) return 'record';
  if (b.chargeTo !== 'owner') return 'company';
  return b.final ? 'charged' : 'pending';
}

/** A cell holding several bills shows the state that most needs attention. */
const ORDER: BillState[] = ['pending', 'charged', 'record', 'company'];

export interface Cell { amount: number; state: BillState | RequestState | null; bills: GridBill[] }

/** Cells keyed `${unitId}|${kind}|${month}`, and `${unitId}|total|${month}` (no state). */
function cellsBy<S extends BillState | RequestState>(bills: GridBill[], month: (b: GridBill) => string | null, state: (b: GridBill) => S | null, order: S[],
  amount: (b: GridBill) => number = b => b.amount): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const add = (key: string, b: GridBill, s: S | null) => {
    const c: Cell = cells.get(key) ?? { amount: 0, state: s, bills: [] };
    c.amount += amount(b); c.bills.push(b);
    if (s && c.state && order.indexOf(s) < order.indexOf(c.state as S)) c.state = s;
    cells.set(key, c);
  };
  for (const b of bills) {
    const m = month(b);
    if (!m) continue;
    add(`${b.unitId}|${b.kind}|${m}`, b, state(b));
    add(`${b.unitId}|total|${m}`, b, null);
  }
  return cells;
}

/** By bill month: a bill sits in its bill month, coloured by whether the owner has been charged. */
export function buildCells(bills: GridBill[]): Map<string, Cell> {
  return cellsBy(bills, b => b.billMonth, billState, ORDER);
}

/** By payment request: a bill sits in the month its request was made, coloured by the request; bills with no request,
 *  or on a rejected or withdrawn one, are left out. */
export function buildRequestCells(bills: GridBill[]): Map<string, Cell> {
  const live = (b: GridBill) => (b.request ? requestState(b.request.status) : null);
  return cellsBy(bills, b => (live(b) ? b.request!.month : null), live, REQUEST_ORDER, b => b.request?.amount ?? b.amount);
}

const shift = (m: string, by: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** The months from `from` to `to`, newest first. */
export function months(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = to; m >= from; m = shift(m, -1)) out.push(m);
  return out;
}

/** Per month: total ÷ months with a bill. Per night: total of the months with nights ÷ those nights. */
export function unitAverages(cells: Map<string, Cell>, unitId: string, monthList: string[], nights: Record<string, number>) {
  let total = 0, billed = 0, nightCost = 0, nightCount = 0;
  for (const m of monthList) {
    const c = cells.get(`${unitId}|total|${m}`);
    if (!c) continue;
    total += c.amount; billed++;
    const nn = nights[m] ?? 0;
    if (nn > 0) { nightCost += c.amount; nightCount += nn; }
  }
  return { perMonth: billed ? Math.round(total / billed) : null, perNight: nightCount ? Math.round(nightCost / nightCount) : null };
}

export interface UnusualRow {
  unitId: string; kind: UtilityKind; month: string; amount: number;
  /** Average of the same kind over the previous three months that have a bill. */
  baseline: number; changePct: number; nights: number; baselineNights: number;
}

/** A bill more than 50 % above or below the unit's average of the same kind over the previous three months, judged
 *  only when at least two of those months have a bill. Largest change first. */
export function unusual(cells: Map<string, Cell>, unitIds: string[], monthList: string[], nightsByUnit: Record<string, Record<string, number>>): UnusualRow[] {
  const rows: UnusualRow[] = [];
  for (const unitId of unitIds) {
    const nights = nightsByUnit[unitId] ?? {};
    for (const kind of KINDS) {
      for (const month of monthList) {
        const c = cells.get(`${unitId}|${kind}|${month}`);
        if (!c) continue;
        const prev = [1, 2, 3].map(i => shift(month, -i));
        const had = prev.filter(m => cells.has(`${unitId}|${kind}|${m}`));
        if (had.length < 2) continue;
        const baseline = had.reduce((s, m) => s + cells.get(`${unitId}|${kind}|${m}`)!.amount, 0) / had.length;
        if (baseline <= 0) continue;
        const changePct = Math.round(((c.amount - baseline) / baseline) * 1000) / 10;
        if (Math.abs(changePct) <= 50) continue;
        rows.push({ unitId, kind, month, amount: c.amount, baseline: Math.round(baseline), changePct,
          nights: nights[month] ?? 0, baselineNights: Math.round(had.reduce((s, m) => s + (nights[m] ?? 0), 0) / had.length) });
      }
    }
  }
  return rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}
