/**
 * Staff receipts, petty cash and payment requests (finance, 28-29 Oct 2026; SOP 3.2, 6; design
 * docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md). The data lives in the engine; Property OS
 * reaches it through /api/claims/*, which forwards on the person's behalf (functions/api/claims/[[path]].ts).
 * Shared by the desk's My claims page and the field portal.
 */
import { api } from './api';
import { buildingName, todayMyt } from './format';
import { requestBillFill, type RequestBillRead } from './requestBill';
import { bankProblem, type ClaimBank } from './claimBank';
import type { StatusTone } from './status';

export type LineDepartment = 'rental' | 'supply' | 'shared';
export type ReceiptStatus = 'HANDED_IN' | 'CHECKED' | 'TOPPED_UP' | 'PAID_BACK' | 'REJECTED' | 'REPAID' | 'WRITTEN_OFF' | 'REPLACED' | 'RENO_REVIEW';
export type RequestStatus = 'RENO_REVIEW' | 'SUBMITTED' | 'PART_PAID' | 'PAID' | 'REJECTED' | 'CLOSED' | 'WITHDRAWN';
export interface ClaimLine {
  department: LineDepartment; unitId: string | null; maintenanceIssueId: string | null; projectId: number | null; accountCode: string | null; amountSen: number; description: string | null;
  targetLabel?: string | null; subDepartmentId?: string | null;
}
export interface ClaimFile { id: string; fileName: string; mime: string }
export interface Receipt {
  id: string; receiptNo: string; submitterName: string; floatId: string | null; spendDate: string; amountSen: number; vendorName: string | null;
  note: string | null; status: ReceiptStatus; rejectReason: string | null; lines: ClaimLine[]; files: ClaimFile[]; renoReviewedBy?: string | null; renoReviewedAt?: string | null;
  /** What each unit's owner pays back (0363): charged to the owner as O2 once finance checks the claim (`charged`). */
  recoveries?: { unitId: string; amountSen: number; charged: boolean }[];
  /** The bank given on a Direct Claim to Me (the receipt's payee bank); absent when the engine does not send it. */
  bank?: ClaimBank | null;
}
export interface PaymentRequest {
  id: string; requestNo: string; type: 'PAYMENT' | 'DEPOSIT'; payeeName: string; amountSen: number; status: RequestStatus; reason: string | null;
  createdAt: string; wantedOn: string | null; note: string | null; lines: ClaimLine[]; files: ClaimFile[]; vouchers: { id: string; pvNumber: string; status: string }[];
  /** What each unit's owner pays back (0352): charged to the owner as O2 once the request is paid (`charged`). */
  recoveries?: { unitId: string; amountSen: number; charged: boolean }[];
  /** As asked: the supplier on the list, or the PO, and who decided last (a rejection). */
  supplierId?: string | null; purchaseOrderId?: string | null; decidedBy?: string | null;
  requesterName?: string | null; renoReviewedBy?: string | null; renoReviewedAt?: string | null;
  /** Made from utility bills: fixed and sent again on Utility bills (lib/requestResubmit.ts). */
  fromBills?: boolean;
  /** The AP invoice it is paid through (chew, 15 Nov 2026; lib/requestApInvoice.ts): a quotation until the formal invoice
   *  comes; a balance's deposit and a deposit's balance requests; what was first asked, once the invoice changed it. */
  apInvoice?: { id: string; invoiceNumber: string; status: string; provisional: boolean; totalSen: number; paidSen: number } | null;
  parentRequestNo?: string | null;
  balanceRequests?: { id: string; requestNo: string; status: string }[];
  askedLines?: Array<{ amountSen: number; description: string | null }> | null;
  askedAmountSen?: number | null;
}
export interface Me { userId: string; name: string; field: boolean; lineDepartment: LineDepartment; route: 'float' | 'finance'; keepsFloat: boolean }
export interface MyFloat { float: { id: string; floatSen: number; balanceSen: number; low: boolean; lastTopUpOn: string | null; topUpRequested: boolean; topUpRequestNo?: string | null }; receipts: Receipt[] }
/** A line as staff send it: the engine sets the department from the person and finance sets the account (2 Nov 2026). */
export interface NewLine { unitId?: string; maintenanceIssueId?: string; projectId?: number; amountSen: number; description?: string; subDepartmentId?: string;
  /** On a line for a unit (a payment request, or a claim): what its owner pays back (chew, 20 and 23 Nov 2026). */
  recoverSen?: number }
/** A sub-department a line can be put on (SOP 1.1: the department starts as the person's, and may be changed): GET /claims/sub-departments. */
export interface LineSubDepartment { id: string; department: LineDepartment; name: string;
  /** A Renovation sub-department's brand (its projects'); a Rental one whose lines may name a maintenance job. */
  renoKind?: 'RENOVATION' | 'INHOUSE_RENOVATION' | null; maintenance?: boolean }

export const DEPARTMENT: Record<LineDepartment, string> = { rental: 'Rental', supply: 'Renovation', shared: 'Shared' };
export const RECEIPT_STATUS: Record<ReceiptStatus, string> = {
  HANDED_IN: 'Waiting for a check', CHECKED: 'Checked', TOPPED_UP: 'Paid back', PAID_BACK: 'Paid back',
  REJECTED: 'Rejected', REPAID: 'Repaid', WRITTEN_OFF: 'Written off', REPLACED: 'Replaced', RENO_REVIEW: 'With renovation review',
};
export const REQUEST_STATUS: Record<RequestStatus, string> = {
  RENO_REVIEW: 'With renovation review', SUBMITTED: 'Waiting for payment', PART_PAID: 'Part paid', PAID: 'Paid', REJECTED: 'Rejected', CLOSED: 'Closed', WITHDRAWN: 'Withdrawn',
};
export function describeClaimLine(line: ClaimLine): string {
  if (line.maintenanceIssueId) return `Maintenance job: ${line.targetLabel ?? 'not found'}`;
  if (line.unitId) return `Unit ${buildingName(line.targetLabel)}`.trim();
  if (line.projectId != null) return `Project ${line.targetLabel ?? ''}`.trim();
  return `${DEPARTMENT[line.department]} department`;
}
export const RECEIPT_TONE: Record<ReceiptStatus, StatusTone> = {
  HANDED_IN: 'warning', CHECKED: 'info', TOPPED_UP: 'success', PAID_BACK: 'success',
  REJECTED: 'danger', REPAID: 'neutral', WRITTEN_OFF: 'neutral', REPLACED: 'neutral', RENO_REVIEW: 'info',
};
export const REQUEST_TONE: Record<RequestStatus, StatusTone> = {
  RENO_REVIEW: 'info', SUBMITTED: 'warning', PART_PAID: 'info', PAID: 'success', REJECTED: 'danger', CLOSED: 'neutral', WITHDRAWN: 'neutral',
};

/** A receipt's file, opened in the browser (the session cookie goes with it). */
export const receiptFileHref = (receiptId: string, fileId: string) => `/api/claims/receipts/${receiptId}/files/${fileId}`;
export const renoReviewFileHref = (requestId: string, fileId: string) => `/api/claims/reno-review/${requestId}/files/${fileId}`;
export const requestFileHref = (requestId: string, fileId: string) => `/api/claims/requests/${requestId}/files/${fileId}`;

/** What the photo says: the amount, the date and the shop, or nothing when it cannot be read. */
export async function readReceipt(files: File[]): Promise<{ amountSen: number | null; date: string | null; vendorName: string | null }> {
  const form = new FormData();
  form.set('data', '{}');
  for (const f of files) form.append('file', f);
  try { return await api.post('/claims/extract', form); } catch { return { amountSen: null, date: null, vendorName: null }; }
}

/** What a Direct pay request's bill says (requestBill.ts), read by the engine's bill reader. */
export async function readRequestBill(files: File[]): Promise<RequestBillRead> {
  const form = new FormData();
  form.set('data', JSON.stringify({ kind: 'request' }));
  for (const f of files) form.append('file', f);
  try { return await api.post('/claims/extract', form); } catch { return { amountSen: null, date: null, vendorName: null }; }
}
export { requestBillFill };

export { bankProblem, type ClaimBank };
/** The person's own saved bank details, to prefill a Direct Claim to Me; null when none are saved or the read fails, and
 *  the person types them. Only read: what is changed on the claim stays on the claim. */
export async function myBank(): Promise<ClaimBank | null> {
  try {
    const { bank } = await api.get<{ bank: { bankName: string | null; accountNo: string | null; accountName: string | null } | null }>('/claims/my-bank');
    return bank ? { bankName: bank.bankName ?? '', accountNo: bank.accountNo ?? '', accountName: bank.accountName ?? '' } : null;
  } catch { return null; }
}

/** Hands a receipt in (or asks finance to pay, or sends a changed request again): the fields as JSON beside the files. */
export function postWithFiles<T>(path: '/claims/receipts' | '/claims/requests' | `/claims/requests/${string}/resubmit` | `/claims/requests/${string}/balance` | `/claims/reno-review/${string}/send`, data: Record<string, unknown>, files: File[]): Promise<T> {
  const form = new FormData();
  form.set('data', JSON.stringify(data));
  for (const f of files) form.append('file', f);
  return api.post<T>(path, form);
}

/** This month in Malaysia, YYYY-MM. */
export const thisMonthMyt = () => todayMyt().slice(0, 7);
