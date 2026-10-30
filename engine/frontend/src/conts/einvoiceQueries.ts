// Conts only: e-invoice settings and outbox (backend acc/einvoice-routes.ts, /accounting/einvoice/*). Nothing here sends
// anything to LHDN; the connector comes later.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type EInvoiceSeller = {
  tin: string; brn: string; sstNo: string; msicCode: string; activityDesc: string;
  address1: string; address2: string; city: string; postcode: string; stateCode: string; phone: string; email: string;
};
export type EInvoiceSettings = {
  active: boolean; classificationCode: string; taxType: string; sstEnabled: boolean;
  sstMode: "EXCLUSIVE" | "INCLUSIVE" | null; sstOutputAccount: string | null; renoDescriptionTemplate: string; seller: EInvoiceSeller;
};
export type EInvoiceSettingsView = EInvoiceSettings & { sellerMissing: string[]; taxTypes: Record<string, string>; recheckRemaining?: number | null };

/** The editable part of the server's answer. */
export function formOf(v: EInvoiceSettingsView): EInvoiceSettings {
  const { sellerMissing: _m, taxTypes: _t, recheckRemaining: _r, ...rest } = v;
  return rest;
}

export type OutboxStatus = "NOT_READY" | "READY" | "SUBMITTED" | "VALID" | "REJECTED" | "CANCELLED";
export type OutboxRow = {
  id: string; docKind: "INVOICE" | "CREDIT_NOTE"; docNumber: string; debtorCode: string | null; debtorName: string | null;
  date: string | null; amountSen: number; status: OutboxStatus; missing: string[];
};
export type OutboxDetail = OutboxRow & { payload: unknown; preparedAt: string };

const SETTINGS = ["einvoice-settings"];
const OUTBOX = ["einvoice-outbox"];

export const useEInvoiceSettings = () => useQuery({
  queryKey: SETTINGS,
  queryFn: () => authedFetch<EInvoiceSettingsView>("/accounting/einvoice/settings"),
  staleTime: 30_000,
});

export const useSaveEInvoiceSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EInvoiceSettings) => authedFetch<EInvoiceSettingsView>("/accounting/einvoice/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (data) => { qc.setQueryData(SETTINGS, data); void qc.invalidateQueries({ queryKey: OUTBOX }); },
  });
};

export const useOutbox = (status: string) => useQuery({
  queryKey: [...OUTBOX, status],
  queryFn: () => authedFetch<{ rows: OutboxRow[]; counts: Record<OutboxStatus, number> }>(
    `/accounting/einvoice/outbox${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  staleTime: 15_000,
});

export const useOutboxRow = (id: string | null) => useQuery({
  queryKey: [...OUTBOX, "row", id],
  queryFn: () => authedFetch<OutboxDetail>(`/accounting/einvoice/outbox/${encodeURIComponent(id as string)}`),
  enabled: !!id,
});

export const useRefreshOutbox = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authedFetch<{ refreshed: number; remaining: number }>("/accounting/einvoice/outbox/refresh", { method: "POST" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: OUTBOX }); },
  });
};

/** The invoice line description for an instalment, as the backend renders it (scm/lib/reno-invoice-description.ts):
    a preview only, so finance sees the template's result before saving. */
export function previewDescription(tpl: string, v: { seq: number; pctBp: number; label: string; soDocNo: string }): string {
  const teen = v.seq % 100 >= 11 && v.seq % 100 <= 13;
  const ord = `${v.seq}${teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[v.seq % 10] ?? "th"}`;
  return tpl
    .replace(/\{ordinal\}/g, () => ord).replace(/\{seq\}/g, () => String(v.seq)).replace(/\{pct\}/g, () => `${Number((v.pctBp / 100).toFixed(2))}%`)
    .replace(/\{so\}/g, () => v.soDocNo).replace(/\{label\}/g, () => v.label)
    .replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")").trim();
}

export const STATUS_LABEL: Record<OutboxStatus, string> = {
  NOT_READY: "Not ready", READY: "Ready", SUBMITTED: "Submitted", VALID: "Valid", REJECTED: "Rejected", CANCELLED: "Cancelled",
};

export const LHDN_STATES: Array<[string, string]> = [
  ["01", "Johor"], ["02", "Kedah"], ["03", "Kelantan"], ["04", "Melaka"], ["05", "Negeri Sembilan"], ["06", "Pahang"], ["07", "Pulau Pinang"],
  ["08", "Perak"], ["09", "Perlis"], ["10", "Selangor"], ["11", "Terengganu"], ["12", "Sabah"], ["13", "Sarawak"], ["14", "Kuala Lumpur"],
  ["15", "Labuan"], ["16", "Putrajaya"],
];
