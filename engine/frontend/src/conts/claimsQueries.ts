// Conts only (not part of Houzs's code): finance's petty cash and payment requests (SOP 3.2, 6; design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md), from /api/scm/accounting
// (petty-cash-routes.ts, payment-request-routes.ts). Staff hand in receipts in Property OS.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type LineDepartment = "rental" | "supply" | "shared";
export type ReceiptStatus = "HANDED_IN" | "CHECKED" | "TOPPED_UP" | "PAID_BACK" | "REJECTED" | "REPAID" | "WRITTEN_OFF" | "REPLACED";
export type ClaimLine = {
  department: LineDepartment; unitId: string | null; maintenanceIssueId: string | null; projectId: number | null;
  accountCode: string | null; amountSen: number; description: string | null;
};
export type Receipt = {
  id: string; receiptNo: string; submitterUserId: string; submitterName: string; floatId: string | null; spendDate: string;
  amountSen: number; vendorName: string | null; note: string | null; status: ReceiptStatus; rejectReason: string | null;
  checkedAt: string | null; checkedBy: string | null; topUpPvId: string | null; paybackPvId: string | null; replacesId: string | null;
  source: string; lines: ClaimLine[]; files: { id: string; fileName: string; mime: string }[]; overLimit?: boolean;
};
export type RequestStatus = "SUBMITTED" | "PART_PAID" | "PAID" | "REJECTED" | "CLOSED" | "WITHDRAWN";
export type PaymentRequest = {
  id: string; requestNo: string; type: "PAYMENT" | "DEPOSIT"; requesterUserId: string; requesterName: string; supplierId: string | null;
  payeeName: string; payeeToCheck: boolean; purchaseOrderId: string | null; wantedOn: string | null; owesFormalInvoice: boolean;
  note: string | null; amountSen: number; status: RequestStatus; reason: string | null; decidedBy: string | null; createdAt: string;
  lines: ClaimLine[]; files: { id: string; fileName: string; mime: string }[]; vouchers: { id: string; pvNumber: string; status: string }[];
};
export type FloatSummary = {
  id: string; floatSen: number; balanceSen: number; low: boolean; lastTopUpOn: string | null; topUpRequested?: boolean;
  departmentName?: string; keeperName?: string; warnPct?: number; active?: boolean;
  /** The float's own account in the chart, e.g. 315-0101 PETTY CASH - AMIN; null books nothing. */
  accountCode: string | null; accountName: string | null;
};
export type FloatRow = FloatSummary & {
  departmentId: string; departmentName: string; keeperUserId: string; keeperName: string; warnPct: number; active: boolean;
  topUpRequested: boolean; waitingCheckSen: number; waitingCheckCount: number;
};

/* Plain words for statuses, the same everywhere. */
export const RECEIPT_STATUS: Record<ReceiptStatus, string> = {
  HANDED_IN: "Waiting for a check", CHECKED: "Checked", TOPPED_UP: "Topped up", PAID_BACK: "Paid back",
  REJECTED: "Rejected", REPAID: "Repaid", WRITTEN_OFF: "Written off", REPLACED: "Replaced",
};
export const REQUEST_STATUS: Record<RequestStatus, string> = {
  SUBMITTED: "Waiting for payment", PART_PAID: "Part paid", PAID: "Paid", REJECTED: "Rejected", CLOSED: "Closed", WITHDRAWN: "Withdrawn",
};
export const DEPARTMENT: Record<LineDepartment, string> = { rental: "Rental", supply: "Supply chain", shared: "Shared" };

const PETTY = "/accounting/petty-cash";
const REQUESTS = "/accounting/payment-requests";

export const financeReceiptFileUrl = (receiptId: string, fileId: string, mime: string) => api.fetchBlobUrl(`/api/scm${PETTY}/receipts/${receiptId}/files/${fileId}`, mime);
export const requestFileUrl = (requestId: string, fileId: string, mime: string) => api.fetchBlobUrl(`/api/scm${REQUESTS}/${requestId}/files/${fileId}`, mime);

/* ── Finance ───────────────────────────────────────────────────────── */
export const useFloats = () => useQuery({
  queryKey: ["petty-floats"],
  queryFn: () => authedFetch<{ floats: FloatRow[]; totals: { floatSen: number; balanceSen: number; waitingCheckSen: number } }>(`${PETTY}/floats`),
});
export const useFloatReceipts = (floatId: string, month: string) => useQuery({
  queryKey: ["petty-float", floatId, month],
  queryFn: () => authedFetch<{ float: FloatSummary; receipts: Receipt[] }>(`${PETTY}/floats/${floatId}/receipts${month ? `?month=${month}` : ""}`),
});
export const useFinanceReceipts = (month: string) => useQuery({
  queryKey: ["petty-finance", month], queryFn: () => authedFetch<{ receipts: Receipt[] }>(`${PETTY}/receipts${month ? `?month=${month}` : ""}`),
});
export const useOverrides = () => useQuery({ queryKey: ["petty-overrides"], queryFn: () => authedFetch<{ overrides: { userId: string; floatId: string }[] }>(`${PETTY}/overrides`) });
export const usePaymentRequests = (status: string) => useQuery({
  queryKey: ["payment-requests", status], queryFn: () => authedFetch<{ requests: PaymentRequest[] }>(`${REQUESTS}${status ? `?status=${status}` : ""}`),
});

/** One mutation for every finance action: the path and body, then everything petty cash and requests refreshes. */
export const useFinanceAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = "POST", body = {} }: { path: string; method?: "POST" | "PATCH" | "PUT"; body?: unknown }) =>
      authedFetch<Record<string, unknown>>(path, { method, body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of ["petty-floats", "petty-float", "petty-finance", "petty-overrides", "payment-requests"]) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
};
export const pettyPath = PETTY;
export const requestsPath = REQUESTS;
