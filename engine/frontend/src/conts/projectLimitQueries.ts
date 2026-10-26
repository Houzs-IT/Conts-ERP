// Conts only (not part of Houzs's code): a project's limit and extra limit (finance phase 1.5; SOP 3.4; backend
// conts/project-limit-routes.ts under /accounting).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type ProjectOption = { id: number; code: string | null; name: string; funding: "customer" | "internal" };
export type ProjectLimit = {
  projectId: number; projectName: string; funding: "customer" | "internal"; pctBp: number | null; receivedSen: number | null;
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
