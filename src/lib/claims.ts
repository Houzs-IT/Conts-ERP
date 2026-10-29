/**
 * Staff receipts, petty cash and payment requests (finance, 28-29 Oct 2026; SOP 3.2, 6; design
 * docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md). The data lives in the engine; Property OS
 * reaches it through /api/claims/*, which forwards on the person's behalf (functions/api/claims/[[path]].ts).
 * Shared by the desk's My claims page and the field portal.
 */
import { api } from './api';
import { todayMyt } from './format';

export type LineDepartment = 'rental' | 'supply' | 'shared';
export type ReceiptStatus = 'HANDED_IN' | 'CHECKED' | 'TOPPED_UP' | 'PAID_BACK' | 'REJECTED' | 'REPAID' | 'WRITTEN_OFF' | 'REPLACED';
export type RequestStatus = 'SUBMITTED' | 'PART_PAID' | 'PAID' | 'REJECTED' | 'CLOSED' | 'WITHDRAWN';
export interface ClaimLine { department: LineDepartment; unitId: string | null; maintenanceIssueId: string | null; projectId: number | null; accountCode: string | null; amountSen: number; description: string | null }
export interface Receipt {
  id: string; receiptNo: string; submitterName: string; floatId: string | null; spendDate: string; amountSen: number; vendorName: string | null;
  note: string | null; status: ReceiptStatus; rejectReason: string | null; lines: ClaimLine[]; files: { id: string; fileName: string; mime: string }[];
}
export interface PaymentRequest {
  id: string; requestNo: string; type: 'PAYMENT' | 'DEPOSIT'; payeeName: string; amountSen: number; status: RequestStatus; reason: string | null;
  createdAt: string; wantedOn: string | null; lines: ClaimLine[]; vouchers: { id: string; pvNumber: string; status: string }[];
}
export interface Me { userId: string; name: string; field: boolean; lineDepartment: LineDepartment; route: 'float' | 'finance'; keepsFloat: boolean }
export interface MyFloat { float: { id: string; floatSen: number; balanceSen: number; low: boolean; lastTopUpOn: string | null; topUpRequested: boolean }; receipts: Receipt[] }
export interface NewLine { department: LineDepartment; unitId?: string; maintenanceIssueId?: string; projectId?: number; accountCode?: string; amountSen: number; description?: string }

export const DEPARTMENT: Record<LineDepartment, string> = { rental: 'Rental', supply: 'Supply chain', shared: 'Shared' };
export const RECEIPT_STATUS: Record<ReceiptStatus, string> = {
  HANDED_IN: 'Waiting for a check', CHECKED: 'Checked', TOPPED_UP: 'Paid back', PAID_BACK: 'Paid back',
  REJECTED: 'Rejected', REPAID: 'Repaid', WRITTEN_OFF: 'Written off', REPLACED: 'Replaced',
};
export const REQUEST_STATUS: Record<RequestStatus, string> = {
  SUBMITTED: 'Waiting for payment', PART_PAID: 'Part paid', PAID: 'Paid', REJECTED: 'Rejected', CLOSED: 'Closed', WITHDRAWN: 'Withdrawn',
};

/** A receipt's file, opened in the browser (the session cookie goes with it). */
export const receiptFileHref = (receiptId: string, fileId: string) => `/api/claims/receipts/${receiptId}/files/${fileId}`;

/** What the photo says: the amount, the date and the shop, or nothing when it cannot be read. */
export async function readReceipt(files: File[]): Promise<{ amountSen: number | null; date: string | null; vendorName: string | null }> {
  const form = new FormData();
  form.set('data', '{}');
  for (const f of files) form.append('file', f);
  try { return await api.post('/claims/extract', form); } catch { return { amountSen: null, date: null, vendorName: null }; }
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
