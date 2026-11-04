// Conts only (not part of Houzs's code): the sub-department list (SOP 1.1; chew 4 Nov 2026; backend
// conts/sub-department-routes.ts under /accounting).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import type { Department } from "./department";

export type FixedKey = "rental_general" | "dreamcrafter" | "theconts" | "company";
export type SubDepartment = {
  id: string; department: Department; name: string; fixedKey: FixedKey | null; staffDepartmentId: string | null; active: boolean; sort: number;
};
export type StaffDepartment = { id: string; name: string };

export const useSubDepartments = () => useQuery({
  queryKey: ["conts-sub-departments"],
  queryFn: () => authedFetch<{ subDepartments: SubDepartment[] }>("/accounting/sub-departments"),
  staleTime: 60_000,
});

export const useStaffDepartments = () => useQuery({
  queryKey: ["conts-staff-departments"],
  queryFn: () => authedFetch<{ departments: StaffDepartment[] }>("/accounting/staff-departments"),
  staleTime: 300_000,
});

export type SubDepartmentSave =
  | { id?: undefined; department: Department; name: string; staffDepartmentId?: string | null }
  | { id: string; name?: string; staffDepartmentId?: string | null; active?: boolean; sort?: number };

export const useSaveSubDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SubDepartmentSave) => authedFetch<{ subDepartment: unknown }>(
      id ? `/accounting/sub-departments/${encodeURIComponent(id)}` : "/accounting/sub-departments",
      { method: id ? "PUT" : "POST", body: JSON.stringify(body) },
    ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["conts-sub-departments"] }); },
  });
};
