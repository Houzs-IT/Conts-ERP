/* The renovation catalog's sub-categories as stored in the database
   (backend scm/routes/renovation-catalog-settings.ts). Until the list arrives,
   and if it cannot be read, readers fall back to the built-in seed
   (shared/renovation-catalog.ts SUB_CATEGORIES), which is what the database
   starts with; the settings drawer shows the load error. Units (migration
   0118) arrive in the same response and fall back to UOMS the same way. */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';
import { SUB_CATEGORIES, UOMS, subCategoriesOf, uomPrintLabel, type CatalogGroup, type SubCategoryDef, type UomDef } from '../../shared/renovation-catalog';

type CatalogResponse = { subCategories: SubCategoryDef[]; uoms?: UomDef[]; canEdit: boolean };

const KEY = ['renovation-catalog'] as const;

export function useRenovationCatalog() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => authedFetch<CatalogResponse>('/renovation-catalog'),
    staleTime: 5 * 60_000,
  });
  const all: readonly SubCategoryDef[] = q.data?.subCategories ?? SUB_CATEGORIES;
  const uoms: readonly UomDef[] = q.data?.uoms ?? UOMS;
  const read = useMemo(() => ({
    /** What a picker offers: the group's shown sub-categories, plus `keep` when a SKU already carries a hidden one. */
    pickable: (group: CatalogGroup, keep?: string | null) =>
      subCategoriesOf(group, all).filter((s) => s.active !== false || s.code === keep),
    label: (code: string | null | undefined): string => (code ? (all.find((s) => s.code === code)?.label ?? code) : ''),
    /** Units a picker offers: the shown ones, plus `keep` when a SKU or line already carries a hidden one. */
    pickableUoms: (keep?: string | null) => uoms.filter((u) => u.active !== false || u.code === keep),
    uomPrint: (code: string | null | undefined): string => uomPrintLabel(code, uoms),
  }), [all, uoms]);
  return { query: q, all, uoms, canEdit: q.data?.canEdit ?? false, ...read };
}

export function useAddSubCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { group: CatalogGroup; label: string }) =>
      authedFetch<{ ok: boolean; code: string }>('/renovation-catalog/sub-categories', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateSubCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, ...patch }: { code: string; label?: string; sortOrder?: number; active?: boolean }) =>
      authedFetch<{ ok: boolean }>(`/renovation-catalog/sub-categories/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAddUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { code: string; label: string; measure: boolean }) =>
      authedFetch<{ ok: boolean; code: string }>('/renovation-catalog/uoms', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, ...patch }: { code: string; label?: string; sortOrder?: number; active?: boolean }) =>
      authedFetch<{ ok: boolean }>(`/renovation-catalog/uoms/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      authedFetch<{ ok: boolean }>(`/renovation-catalog/uoms/${encodeURIComponent(code)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
