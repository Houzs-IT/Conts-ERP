/** Petty cash arithmetic (finance; SOP 6; design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md
 *  §4.5). One float per department, kept by one person. A receipt handed in on a float is paid from it at once; the
 *  balance is the cash the keeper should hold. Pure functions, so the routes and the screens agree. Amounts in sen. */

export type ReceiptStatus = 'HANDED_IN' | 'CHECKED' | 'TOPPED_UP' | 'PAID_BACK' | 'REJECTED' | 'REPAID' | 'WRITTEN_OFF' | 'REPLACED';
export type LineDepartment = 'rental' | 'supply' | 'shared';
export interface FloatEvent { kind: 'PAID_IN' | 'RETURNED' | 'REPAID'; amountSen: number }

/** The cash the keeper held when the float started on the ERP, plus money paid to the keeper, less every receipt on
 *  the float (a replaced one is counted through its replacement), plus repayments of rejected receipts, less cash
 *  returned to finance. Below zero is the keeper's own money. */
export function floatBalance(events: FloatEvent[], receipts: { amountSen: number; status: ReceiptStatus }[], openingSen = 0): number {
  let sen = openingSen;
  for (const e of events) sen += e.kind === 'RETURNED' ? -e.amountSen : e.amountSen;
  for (const r of receipts) if (r.status !== 'REPLACED') sen -= r.amountSen;
  return sen;
}

/** A top-up brings the float back to its amount (chew, 28 Oct 2026: overspending is paid back in full next time). */
export function topUpAmount(floatSen: number, balanceSen: number): number {
  return Math.max(0, floatSen - balanceSen);
}

export function lowBalance(floatSen: number, balanceSen: number, warnPct: number): boolean {
  return floatSen > 0 && balanceSen * 100 < floatSen * warnPct;
}

/** Which float pays a person's receipts: their own override, else their department's active float, else none (finance
 *  pays them back by bank transfer). */
export function resolveFloatId(userId: string, departmentId: string | null, overrides: Map<string, string>,
  activeFloatByDept: Map<string, string>): string | null {
  return overrides.get(userId) ?? (departmentId ? activeFloatByDept.get(departmentId) ?? null : null);
}

/** A person's default line department, from their department's side. */
export function lineDepartment(side: string | null | undefined): LineDepartment {
  return side === 'conts' ? 'rental' : side === 'dream_crafter' ? 'supply' : 'shared';
}

/** Whether a receipt's project lines count as used in the project limit. Its money is spent from the moment it is
 *  handed in, so it counts until its own pay-back voucher has posted (that voucher's lines count from then); a repaid
 *  or written-off rejection, a replaced receipt, and a rejected one finance never paid, no longer count. */
export function receiptCountsForLimit(r: { status: ReceiptStatus; floatId: string | null }): boolean {
  if (r.status === 'REJECTED') return r.floatId != null;
  return r.status !== 'REPLACED' && r.status !== 'REPAID' && r.status !== 'WRITTEN_OFF' && r.status !== 'PAID_BACK';
}
