// Conts only (not part of Houzs's code): a project's limit and extra limit (finance phase 1.5; SOP 3.4; backend
// conts/project-limit-routes.ts under /accounting).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type ProjectOption = {
  id: number; code: string | null; name: string; funding: "customer" | "internal";
  /* An internal project's side (rental: a unit to rent out; supply: the showroom), for a voucher line's tag. */
  internal_department?: string | null;
  /* Its brand (SOP 1.1; chew 4 Nov 2026): RENOVATION (Dream Crafter) or INHOUSE_RENOVATION (The Conts). */
  reno_kind?: "RENOVATION" | "INHOUSE_RENOVATION" | null;
  /* For the voucher's project picker (chew 2 Nov 2026): the customer, the contract's status, the handover, done. */
  customer_name: string | null; contract_status: string | null; planned_handover_date: string | null; handed_over_at: string | null;
  created_at: string | null; done: boolean;
};
export type ProjectLimit = {
  projectId: number; projectName: string; funding: "customer" | "internal";
  /* The company checks project limits (Ledger setup); off, the figures are for reference only. */
  checked: boolean;
  pctBp: number | null; receivedSen: number | null;
  limitSen: number; usedSen: number; reservedSen: number; leftSen: number;
};
export type LimitRequest = {
  id: string; project_id: number; project_name: string; kind: "amount" | "pct" | "budget"; amount_sen: number | null; pct_bp: number | null;
  reason: string; status: "PENDING" | "APPROVED" | "REJECTED"; requested_by: string; requested_by_id: string | null; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; created_at: string;
};

export const useProjectOptions = () => useQuery({
  queryKey: ["conts-projects"],
  queryFn: () => authedFetch<{ projects: ProjectOption[] }>("/accounting/projects"),
  staleTime: 60_000,
});

export const useProjectLimit = (projectId: number | null, exceptPvId: string | null = null) => useQuery({
  queryKey: ["conts-project-limit", projectId, exceptPvId],
  queryFn: () => authedFetch<ProjectLimit>(`/accounting/projects/${projectId}/limit${exceptPvId ? `?exceptPvId=${encodeURIComponent(exceptPvId)}` : ""}`),
  enabled: projectId != null,
  staleTime: 15_000,
});

export const useLimitRequests = (status: string) => useQuery({
  queryKey: ["conts-limit-requests", status],
  queryFn: () => authedFetch<{ requests: LimitRequest[] }>(`/accounting/limit-requests${status ? `?status=${status}` : ""}`),
  staleTime: 15_000,
});

export const useAskLimit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }: { projectId: number; kind: string; amountSen?: number; pctBp?: number; reason: string }) =>
      authedFetch<{ request: LimitRequest }>(`/accounting/projects/${projectId}/limit-requests`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["conts-limit-requests"] }); },
  });
};

export const useDecideLimit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: "approve" | "reject"; note?: string }) =>
      authedFetch<{ request: LimitRequest }>(`/accounting/limit-requests/${encodeURIComponent(id)}/${decision}`, { method: "POST", body: JSON.stringify({ note }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conts-limit-requests"] });
      void qc.invalidateQueries({ queryKey: ["conts-project-limit"] });
    },
  });
};

/** The company's limit settings (Ledger setup → Project limit; chew 4 Nov 2026): checked or not, and its share. */
export type LimitSettings = { checked: boolean; pctBp: number };

export const useLimitSettings = () => useQuery({
  queryKey: ["conts-limit-settings"],
  queryFn: () => authedFetch<LimitSettings>("/accounting/project-limit-settings"),
});

export const useSaveLimitSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LimitSettings) => authedFetch<LimitSettings>("/accounting/project-limit-settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conts-limit-settings"] });
      void qc.invalidateQueries({ queryKey: ["conts-project-limit"] });
    },
  });
};

/** The Property OS units, for a voucher's Rental lines (chew 2 Nov 2026). */
export const useUnitOptions = () => useQuery({
  queryKey: ["conts-units"],
  queryFn: () => authedFetch<{ units: Array<{ id: string; building: string; unitNumber: string }> }>("/accounting/units"),
  staleTime: 300_000,
});
