/** Payment requests to finance (SOP 3.2, 3.5; design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md
 *  §4.6): a supplier payment, optionally against a PO, or a deposit. Its status follows the vouchers that pay it. */

export type RequestStatus = 'SUBMITTED' | 'PART_PAID' | 'PAID' | 'REJECTED' | 'CLOSED' | 'WITHDRAWN';
const FINAL = new Set<string>(['REJECTED', 'CLOSED', 'WITHDRAWN']);

/** Submitted until a voucher posts; part paid below its amount; paid at or above it. Rejected, closed and withdrawn
 *  requests stay as they are. */
export function requestStatus(amountSen: number, postedVoucherSen: number, current: string): string {
  if (FINAL.has(current)) return current;
  if (postedVoucherSen <= 0) return 'SUBMITTED';
  return postedVoucherSen >= amountSen ? 'PAID' : 'PART_PAID';
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
