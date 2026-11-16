/* A request to finance paid through an AP invoice (chew, 15 Nov 2026; engine conts/request-ap-invoice.ts): finance books
   the bill (a quotation first, for a deposit), the request follows it, and the balance of a paid deposit is asked for
   from the deposit request with nothing filled in again. */

interface Bill { invoiceNumber: string; provisional: boolean; totalSen: number; paidSen: number }
interface Q { type: string; status: string; amountSen?: number; apInvoice?: Bill | null; balanceRequests?: { status: string }[] }

const OPEN = new Set(['SUBMITTED', 'PART_PAID']);

/** What the balance asks for: what the bill still owes, less a paid deposit finance has not knocked off against it yet
 *  (as the engine counts it: request-ap-invoice.ts balanceRequestHandler). */
export const balanceSen = (q: Q): number => {
  if (!q.apInvoice) return 0;
  const deposit = q.type === 'DEPOSIT' && q.status === 'PAID' ? q.amountSen ?? 0 : 0;
  return Math.max(0, q.apInvoice.totalSen - Math.max(q.apInvoice.paidSen, deposit));
};

/** A paid deposit whose bill still owes something, with no balance asked for yet: "Ask for the balance". */
export const canAskBalance = (q: Q): boolean =>
  q.type === 'DEPOSIT' && (q.status === 'PAID' || q.status === 'PART_PAID') && balanceSen(q) > 0
  && !(q.balanceRequests ?? []).some(b => OPEN.has(b.status));

/** One paid through a bill is changed on the bill, not withdrawn or sent again from here. */
export const onBill = (q: Q): boolean => !!q.apInvoice;

/** The bill as the request shows it: "HCAPI-2611-004 (quotation)". */
export const billLabel = (q: Q): string | null => (q.apInvoice ? `${q.apInvoice.invoiceNumber}${q.apInvoice.provisional ? ' (quotation)' : ''}` : null);

/** Changed by its bill: what was first asked differs from what it asks now. */
export const updatedFromBill = (q: { amountSen: number; askedAmountSen?: number | null; askedLines?: unknown[] | null }): boolean =>
  Array.isArray(q.askedLines) && q.askedLines.length > 0;
