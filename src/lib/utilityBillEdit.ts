/** One utility bill's figures when its amount is changed from Utility bills (chew, 20 Nov 2026: any bill whose payment
 *  voucher is not processed can be changed, record only included). All amounts in sen.
 *  - `whole` is the printed bill, `share` the part on the owner statement's shared costs, `ownerPart` the owner's alone.
 *  - A record-only bill is the owner's whole bill: its share is 0 and its owner part is the whole.
 *  - Left unset, the owner part stays as it was; on a record-only bill it follows the whole, so the bill stays the
 *    owner's. An owner part equal to the whole makes the bill record only; one below it puts the rest back on the share. */
export type BillNow = { whole: number; amount: number; recordOnly: boolean };
export type BillEdit = { whole: number; ownerPart: number; share: number; recordOnly: boolean };

export const partNow = (b: BillNow) => (b.recordOnly ? b.whole : b.whole - b.amount);
export const shareNow = (b: BillNow) => (b.recordOnly ? 0 : b.amount);

export function billEdit(now: BillNow, whole: number, ownerPart?: number | null): BillEdit {
  const part = ownerPart ?? (now.recordOnly ? whole : partNow(now));
  const share = whole - part;
  return { whole, ownerPart: part, share, recordOnly: share <= 0 };
}

/** Why the figures cannot be saved, or null. */
export function billEditProblem(e: BillEdit): string | null {
  if (!Number.isInteger(e.whole) || e.whole <= 0) return 'Enter the whole bill, more than RM 0.00.';
  if (!Number.isInteger(e.ownerPart) || e.ownerPart < 0) return 'The owner’s own part is RM 0.00 or more.';
  if (e.share < 0) return 'The owner’s own part is more than the whole bill.';
  return null;
}
