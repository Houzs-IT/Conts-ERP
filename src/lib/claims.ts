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
export type ReceiptStatus = 'HANDED_IN' | 'CHECKED' | 'TOPPED_UP' | 'PAID_BACK' | 'REJECTED' | 'REPAID' | 'WRITTEN_OFF' | 'REPLACED';
export type RequestStatus = 'SUBMITTED' | 'PART_PAID' | 'PAID' | 'REJECTED' | 'CLOSED' | 'WITHDRAWN';
export interface ClaimLine {
  department: LineDepartment; unitId: string | null; maintenanceIssueId: string | null; projectId: number | null; accountCode: string | null; amountSen: number; description: string | null;
  targetLabel?: string | null;
}
export interface ClaimFile { id: string; fileName: string; mime: string }
export interface Receipt {
  id: string; receiptNo: string; submitterName: string; floatId: string | null; spendDate: string; amountSen: number; vendorName: string | null;
  note: string | null; status: ReceiptStatus; rejectReason: string | null; lines: ClaimLine[]; files: ClaimFile[];
}
export interface PaymentRequest {
  id: string; requestNo: string; type: 'PAYMENT' | 'DEPOSIT'; payeeName: string; amountSen: number; status: RequestStatus; reason: string | null;
  createdAt: string; wantedOn: string | null; note: string | null; lines: ClaimLine[]; files: ClaimFile[]; vouchers: { id: string; pvNumber: string; status: string }[];
}
export interface Me { userId: string; name: string; field: boolean; lineDepartment: LineDepartment; route: 'float' | 'finance'; keepsFloat: boolean }
export interface MyFloat { float: { id: string; floatSen: number; balanceSen: number; low: boolean; lastTopUpOn: string | null; topUpRequested: boolean }; receipts: Receipt[] }
/** A line as staff send it: the engine sets the department from the person and finance sets the account (2 Nov 2026). */
export interface NewLine { unitId?: string; maintenanceIssueId?: string; projectId?: number; amountSen: number; description?: string }

export const DEPARTMENT: Record<LineDepartment, string> = { rental: 'Rental', supply: 'Renovation', shared: 'Shared' };
export const RECEIPT_STATUS: Record<ReceiptStatus, string> = {
  HANDED_IN: 'Waiting for a check', CHECKED: 'Checked', TOPPED_UP: 'Paid back', PAID_BACK: 'Paid back',
  REJECTED: 'Rejected', REPAID: 'Repaid', WRITTEN_OFF: 'Written off', REPLACED: 'Replaced',
};
export const REQUEST_STATUS: Record<RequestStatus, string> = {
  SUBMITTED: 'Waiting for payment', PART_PAID: 'Part paid', PAID: 'Paid', REJECTED: 'Rejected', CLOSED: 'Closed', WITHDRAWN: 'Withdrawn',
};
export function describeClaimLine(line: ClaimLine): string {
  if (line.maintenanceIssueId) return `Maintenance job: ${line.targetLabel ?? 'not found'}`;
  if (line.unitId) return `Unit ${buildingName(line.targetLabel)}`.trim();
  if (line.projectId != null) return `Project ${line.targetLabel ?? ''}`.trim();
  return `${DEPARTMENT[line.department]} department`;
}
export const RECEIPT_TONE: Record<ReceiptStatus, StatusTone> = {
  HANDED_IN: 'warning', CHECKED: 'info', TOPPED_UP: 'success', PAID_BACK: 'success',
  REJECTED: 'danger', REPAID: 'neutral', WRITTEN_OFF: 'neutral', REPLACED: 'neutral',
};
export const REQUEST_TONE: Record<RequestStatus, StatusTone> = {
  SUBMITTED: 'warning', PART_PAID: 'info', PAID: 'success', REJECTED: 'danger', CLOSED: 'neutral', WITHDRAWN: 'neutral',
};

/** A receipt's file, opened in the browser (the session cookie goes with it). */
export const receiptFileHref = (receiptId: string, fileId: string) => `/api/claims/receipts/${receiptId}/files/${fileId}`;
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

/** Hands a receipt in (or asks finance to pay): the fields as JSON beside the files. */
export function postWithFiles<T>(path: '/claims/receipts' | '/claims/requests', data: Record<string, unknown>, files: File[]): Promise<T> {
  const form = new FormData();
  form.set('data', JSON.stringify(data));
  for (const f of files) form.append('file', f);
  return api.post<T>(path, form);
}

/** This month in Malaysia, YYYY-MM. */
export const thisMonthMyt = () => todayMyt().slice(0, 7);
