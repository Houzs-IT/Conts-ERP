/* Wire types and calls for the renovation settings (migration 0087): buildings,
   property types, contractors and brands. Shapes mirror
   engine/backend/src/routes/renovationSettings.ts. */

import { api } from "../../../api/client";
import { useQuery } from "../../../hooks/useQuery";

export interface Building {
  id: number; name: string; state: string | null; property_type_id: number | null; property_type_name: string | null;
  sort_order: number; active: boolean; source: string; project_count: number;
}
export interface PropertyType { id: number; name: string; sort_order: number; active: boolean }
export interface Contractor {
  id: number; name: string; trade: string | null; supplier_id: string; supplier_code: string | null; supplier_name: string | null;
  sort_order: number; active: boolean;
}
export interface Brand { id: number; name: string; color: string | null; active: boolean }
export interface SupplierOption { id: string; code: string; name: string }

const R = "/api/renovation";

export const settingsApi = {
  buildings: () => api.get<{ data: Building[] }>(`${R}/buildings`),
  createBuilding: (b: { name: string; state?: string | null; propertyTypeId?: number | null }) => api.post<{ id: number }>(`${R}/buildings`, b),
  patchBuilding: (id: number, b: Partial<{ name: string; state: string | null; propertyTypeId: number | null; active: boolean }>) =>
    api.patch<{ ok: true }>(`${R}/buildings/${id}`, b),
  propertyTypes: () => api.get<{ data: PropertyType[] }>(`${R}/property-types`),
  createPropertyType: (name: string) => api.post<{ id: number }>(`${R}/property-types`, { name }),
  patchPropertyType: (id: number, b: Partial<{ name: string; active: boolean; sortOrder: number }>) => api.patch<{ ok: true }>(`${R}/property-types/${id}`, b),
  contractors: () => api.get<{ data: Contractor[] }>(`${R}/contractors`),
  supplierOptions: (q: string) => api.get<{ data: SupplierOption[] }>(`${R}/contractors/supplier-options?q=${encodeURIComponent(q)}`),
  createContractor: (b: { name: string; trade?: string | null; supplierId?: string | null }) => api.post<{ id: number; supplierId: string }>(`${R}/contractors`, b),
  patchContractor: (id: number, b: Partial<{ name: string; trade: string | null; active: boolean }>) => api.patch<{ ok: true }>(`${R}/contractors/${id}`, b),
  brands: () => api.get<{ data: Brand[] }>(`${R}/brands`),
};

export function useBuildings() {
  return useQuery(["renovation", "buildings"], () => settingsApi.buildings(), [], { staleTime: 60_000 });
}
export function usePropertyTypes() {
  return useQuery(["renovation", "property-types"], () => settingsApi.propertyTypes(), [], { staleTime: 60_000 });
}
export function useBrands() {
  return useQuery(["renovation", "brands"], () => settingsApi.brands(), [], { staleTime: 60_000 });
}

/** Malaysian states and federal territories, offered (not enforced) for a building's and a project's state. */
export const MY_STATES = [
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak",
  "Perlis", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu",
] as const;

/** The brand a new project starts with: Dream Crafter when it is on the list, else the first active brand. */
export function defaultBrandId(brands: readonly Brand[]): number | null {
  const active = brands.filter((b) => b.active);
  return (active.find((b) => b.name.trim().toLowerCase() === "dream crafter") ?? active[0])?.id ?? null;
}

/** "<BUILDING> <UNIT> <CUSTOMER>" in capitals: the name a new project gets (same rule as the server). */
export function autoProjectName(building: string | null | undefined, unit: string | null | undefined, customer: string | null | undefined): string {
  return [building, unit, customer].map((x) => String(x ?? "").trim().replace(/\s+/g, " ")).filter(Boolean).join(" ").toUpperCase();
}
