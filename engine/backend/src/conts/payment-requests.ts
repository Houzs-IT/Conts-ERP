/** Payment requests to finance (SOP 3.2, 3.5; design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md
 *  §4.6): a supplier payment, optionally against a PO, or a deposit. Its status follows the vouchers that pay it. */

export type RequestStatus = 'SUBMITTED' | 'PART_PAID' | 'PAID' | 'REJECTED' | 'CLOSED' | 'WITHDRAWN' | 'RENO_REVIEW';
const FINAL = new Set<string>(['REJECTED', 'CLOSED', 'WITHDRAWN', 'RENO_REVIEW']);

/** Submitted until a voucher posts; part paid below its amount; paid at or above it. Rejected, closed, withdrawn and
 *  waiting-for-review requests stay as they are. */
export function requestStatus(amountSen: number, postedVoucherSen: number, current: string): string {
  if (FINAL.has(current)) return current;
  if (postedVoucherSen <= 0) return 'SUBMITTED';
  return postedVoucherSen >= amountSen ? 'PAID' : 'PART_PAID';
}

/** A request paid through an AP invoice (chew, 15 Nov 2026; spec 2026-11-15-request-to-ap-invoice-design.md): what is
 *  owed is the bill's, which may be more or less than asked. What the bill paid beyond `apPaidBeforeSen` (its paid when
 *  the request was linked) is this request's. A deposit is still paid by its own amount; any other request is paid when
 *  the bill is. A cancelled bill (`ap` null) leaves the request to its own vouchers, as before. */
export function linkedRequestStatus(q: {
  type: string; amountSen: number; current: string; ownPaidSen: number;
  ap: { status: string; paidSen: number } | null; apPaidBeforeSen: number;
}): string {
  if (FINAL.has(q.current)) return q.current;
  if (!q.ap || q.ap.status === 'CANCELLED') return requestStatus(q.amountSen, q.ownPaidSen, q.current);
  const viaBill = Math.max(0, q.ap.paidSen - q.apPaidBeforeSen);
  if (q.type === 'DEPOSIT') return requestStatus(q.amountSen, q.ownPaidSen + viaBill, q.current);
  if (q.ap.status === 'PAID') return 'PAID';
  return viaBill > 0 || q.ownPaidSen > 0 ? 'PART_PAID' : 'SUBMITTED';
}

/** `totalSen` spread over lines in proportion to their amounts, in whole sen, adding up exactly (the last line takes
 *  the rounding); lines that come to nothing are dropped. A balance request's lines from its bill's. */
export function spreadSen<L extends { amountSen: number }>(lines: L[], totalSen: number): Array<L & { amountSen: number }> {
  const base = lines.reduce((n, l) => n + Math.max(0, l.amountSen), 0);
  if (base <= 0 || totalSen <= 0) return [];
  let given = 0;
  const out = lines.map((l, i) => {
    const sen = i === lines.length - 1 ? totalSen - given : Math.floor((Math.max(0, l.amountSen) * totalSen) / base);
    given += sen;
    return { ...l, amountSen: sen };
  });
  return out.filter(l => l.amountSen > 0);
}

/** What a submitted request still reserves on each project: its own lines, less the lines of its vouchers that are not
 *  cancelled (they reserve or use the limit themselves), never below zero (design §4.6). */
export function requestReservation(requestLines: { projectId: number | null; amountSen: number }[],
  voucherLines: { projectId: number | null; amountSen: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const l of requestLines) if (l.projectId != null) out.set(l.projectId, (out.get(l.projectId) ?? 0) + l.amountSen);
  for (const l of voucherLines) if (l.projectId != null && out.has(l.projectId)) out.set(l.projectId, out.get(l.projectId)! - l.amountSen);
  for (const [p, sen] of out) if (sen <= 0) out.delete(p);
  return out;
}

/** What a request still owes, line by line: the amount its posted vouchers have paid comes off the lines in order, so a
 *  second voucher pays only the rest, each part keeping its own line's project and unit. */
export function linesStillOwed<L extends { amount_sen: number }>(lines: L[], paidSen: number): L[] {
  let left = Math.max(0, paidSen);
  const out: L[] = [];
  for (const l of lines) {
    const take = Math.min(left, l.amount_sen);
    left -= take;
    if (l.amount_sen - take > 0) out.push({ ...l, amount_sen: l.amount_sen - take });
  }
  return out;
}
