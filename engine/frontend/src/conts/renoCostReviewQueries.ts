// Conts only: the renovation expected-cost review (SOP 4.2.1; plan 2026-11-02-renovation-expected-cost-review.md Task 4;
// backend acc/reno-cost-review-routes.ts). Finance — and HOD, given scm.reno_estimate.change — answers a cost alert by
// changing the expected cost or keeping it; every decision is in the log.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type AlertKind = "LINE_OVER" | "LINE_UNDER" | "PROJECT_OVER";
export type CostAlert = {
  id: string; so_doc_no: string; kind: AlertKind; so_item_id: string | null;
  budget_sen: number; committed_sen: number; gap_sen: number;
  status: "OPEN" | "CHANGED" | "KEPT" | "CLEARED"; raised_at: string;
  project_name: string; line_description: string; what: string; po_numbers: string[];
};
export type CostLogRow = {
  id: string; date: string; soDocNo: string; projectName: string; outcome: "Changed" | "Kept";
  oldSen: number | null; newSen: number | null; differenceSen: number | null; cause: string; reason: string; by: string;
};
export type AlertSettings = { minSen: number; pctBp: number; hodNotify: boolean; hodEmails: string };

export const CHANGE_KEY = "scm.reno_estimate.change";
export const COST_ALERTS_BADGE_KEY = ["conts-reno-cost-alerts-count"] as const;

/** An amount typed in RM ("75,000", "RM 1,234.56") as sen; null when it is not an amount. */
export function senFromRm(text: string): number | null {
  const t = text.replace(/^\s*RM\s*/i, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const belowSpent = (newSen: number, spentSen: number): boolean => newSen < spentSen;
export const pctFromBp = (bp: number): string => String(bp / 100);
export function kindWord(k: AlertKind): string {
  if (k === "LINE_OVER") return "Line over budget";
  if (k === "LINE_UNDER") return "Line under budget";
  return "Project over expected cost";
}

export const useCostAlerts = () => useQuery({
  queryKey: ["conts-reno-cost-alerts"],
  queryFn: () => authedFetch<{ alerts: CostAlert[] }>("/accounting/reno-cost-alerts"),
  staleTime: 60_000,
});
export const useCostLog = (from: string, to: string) => useQuery({
  queryKey: ["conts-reno-cost-log", from, to],
  queryFn: () => authedFetch<{ rows: CostLogRow[] }>(`/accounting/reno-expected-cost-log?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  staleTime: 60_000,
});
export const useAlertSettings = () => useQuery({
  queryKey: ["conts-reno-alert-settings"],
  queryFn: () => authedFetch<AlertSettings>("/accounting/reno-alert-settings"),
});

function useInvalidateReview() {
  const qc = useQueryClient();
  return () => {
    for (const k of [["conts-reno-projects"], ["conts-reno-cost-alerts"], ["conts-reno-cost-log"], COST_ALERTS_BADGE_KEY]) {
      void qc.invalidateQueries({ queryKey: k as readonly unknown[] });
    }
  };
}
export function useChangeExpectedCost() {
  const done = useInvalidateReview();
  return useMutation({
    mutationFn: (v: { soDocNo: string; newExpectedSen: number; reason: string }) => authedFetch(
      `/accounting/reno-projects/${encodeURIComponent(v.soDocNo)}/expected-cost`,
      { method: "POST", body: JSON.stringify({ newExpectedSen: v.newExpectedSen, reason: v.reason }) },
    ),
    onSuccess: done,
  });
}
export function useKeepAlert() {
  const done = useInvalidateReview();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) => authedFetch(`/accounting/reno-cost-alerts/${encodeURIComponent(v.id)}/keep`, { method: "POST", body: JSON.stringify({ note: v.note }) }),
    onSuccess: done,
  });
}
export function useSaveAlertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: AlertSettings) => authedFetch<AlertSettings>("/accounting/reno-alert-settings", { method: "PUT", body: JSON.stringify(v) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["conts-reno-alert-settings"] }); },
  });
}
