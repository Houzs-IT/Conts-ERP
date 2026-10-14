/* Calls for the customer + property block (migration 0112).
   SO side: /api/scm/renovation-so-info (engine/backend/src/scm/routes/renovation-so-info.ts),
   read with Sales Orders access. Project side: /api/renovation (routes/renovationProperty.ts). */

import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "../../../vendor/scm/lib/authed-fetch";
import { api } from "../../../api/client";
import type { CustomerPropertyValue, ProjectShared, PropertyLists } from "./customerPropertyModel";

const SO = "/renovation-so-info";

export interface SoInfoLists extends PropertyLists { renovationMode: boolean }

/** The SO form's switch: renovation mode with migration 0112 applied gives the
    renovation form; anything else (or a failed read) keeps Houzs's form. */
export function useSoInfoLists() {
  return useQuery({
    queryKey: ["reno", "so-info", "lists"],
    queryFn: () => authedFetch<SoInfoLists>(`${SO}/lists`),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export const soInfoApi = {
  projects: (q: string) => authedFetch<{ data: ProjectShared[] }>(`${SO}/projects?q=${encodeURIComponent(q)}`),
  project: (id: number) => authedFetch<{ project: ProjectShared }>(`${SO}/projects/${id}`),
  /** An existing SO's order information (the form's value) and its project. */
  so: (docNo: string) => authedFetch<{ info: CustomerPropertyValue; project: ProjectShared | null }>(`${SO}/so/${encodeURIComponent(docNo)}`),
  save: (docNo: string, block: Record<string, unknown>) =>
    authedFetch<{ ok: true; projectId: number | null }>(`${SO}/${encodeURIComponent(docNo)}`, { method: "PUT", body: JSON.stringify(block) }),
};

export interface LinkedSo { docNo: string; kind: string; status: string; soDate: string | null; followsProject: boolean }

export const projectInfoApi = {
  lists: () => api.get<PropertyLists>("/api/renovation/property-lists"),
  get: (id: number) => api.get<{ project: ProjectShared; salesOrders: LinkedSo[] }>(`/api/renovation/${id}/customer-info`),
  save: (id: number, body: Record<string, unknown>) =>
    api.patch<{ ok: true; salesOrdersUpdated: string[]; salesOrdersKept: string[] }>(`/api/renovation/${id}/customer-info`, body),
  addPropertyType: (label: string) => api.post<{ id: number }>("/api/renovation/property-types", { label }),
  patchPropertyType: (id: number, b: { label?: string; active?: boolean; sortOrder?: number }) => api.patch<{ ok: true }>(`/api/renovation/property-types/${id}`, b),
  addLayout: (b: { label: string; bedrooms: number; bathrooms: number }) => api.post<{ id: number }>("/api/renovation/layouts", b),
  patchLayout: (id: number, b: { label?: string; bedrooms?: number; bathrooms?: number; active?: boolean; sortOrder?: number }) =>
    api.patch<{ ok: true }>(`/api/renovation/layouts/${id}`, b),
};

/** The server's sentence for a refused save: its problems list, else its message. */
export function soInfoErrorText(e: unknown): string {
  const err = e as { message?: string; body?: string } | null;
  try {
    const b = JSON.parse(err?.body ?? "{}") as { message?: string; problems?: Array<{ message: string }> };
    if (b.problems?.length) return b.problems.map((p) => p.message).join(" ");
    if (b.message) return b.message;
  } catch { /* not JSON */ }
  return err?.message ?? "The order information was not saved. Try again.";
}
