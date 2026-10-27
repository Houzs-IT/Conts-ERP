/** A bill the owner pays is issued with its receipt (staff comment sheet, Oct 2026: "issue with receipt together"):
 *  every utility bill and additional deduction charged to the owner. Cleaning arrives from cleaning jobs and repairs
 *  from maintenance jobs, which carry their own proof, and a bill the company, a tenant or a guest pays is not on the
 *  owner's statement, so none of those need one. Bills recorded before this rule stay valid and are flagged "No receipt".
 *  Shared by functions/api/expenses and the bill forms. */
export const RECEIPT_EXEMPT_CATEGORIES = ['cleaning', 'housekeeping'];

export function receiptRequired(category: string | null | undefined, chargeTo: string | null | undefined, recordOnly = false): boolean {
  // A record-only bill (the 2026 backfill of months already settled with the owner) is on no statement.
  return !recordOnly && (chargeTo ?? 'owner') === 'owner' && !RECEIPT_EXEMPT_CATEGORIES.includes(String(category ?? ''));
}

/** An existing expense that should carry a receipt and does not: an owner-paid bill typed in by hand or imported, not
 *  one written by a cleaning or maintenance job. */
export function missingReceipt(e: { category: string; chargeTo: string; receiptDocumentId: string | null; taskId?: string | null; maintenanceId?: string | null; recordOnly?: boolean }): boolean {
  return !e.receiptDocumentId && !e.taskId && !e.maintenanceId && receiptRequired(e.category, e.chargeTo, e.recordOnly);
}

export const RECEIPT_REQUIRED = 'Attach the receipt: the owner pays this bill.';
