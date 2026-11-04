/* The renovation catalog's sub-categories as stored in the database
   (backend scm/routes/renovation-catalog-settings.ts). Until the list arrives,
   and if it cannot be read, readers fall back to the built-in seed
   (shared/renovation-catalog.ts SUB_CATEGORIES), which is what the database
   starts with; the settings drawer shows the load error. Units (migration
   0118) arrive in the same response and fall back to UOMS the same way. */
import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';
import { RENOVATION_GROUPS, SUB_CATEGORIES, UOMS, categoryMatches, rememberSubCategories, subCategoriesOf, uomPrintLabel, type CatalogGroup, type SubCategoryDef, type UomDef } from '../../shared/renovation-catalog';
import { MFG_PRODUCT_CATEGORIES, liveCategoryRows, mfgCategoryLabel, rememberCategories } from '../../shared/product-categories';
import { CONTS_RENOVATION_CATALOG } from '../../../conts/catalog';

type CatalogResponse = { groups?: Array<{ code: string; label: string; sort_order: number }>; subCategories: SubCategoryDef[]; uoms?: UomDef[]; canEdit: boolean };

const KEY = ['renovation-catalog'] as const;

export function useRenovationCatalog() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => authedFetch<CatalogResponse>('/renovation-catalog'),
    staleTime: 5 * 60_000,
  });
  const all: readonly SubCategoryDef[] = q.data?.subCategories ?? SUB_CATEGORIES;
  const uoms: readonly UomDef[] = q.data?.uoms ?? UOMS;
  /** The category groups with their names, in their order (product_category_groups). */
  const groups: ReadonlyArray<{ code: string; label: string }> = q.data?.groups ?? RENOVATION_GROUPS;
  /* Pure label and group lookups have no hook of their own; they read what was last loaded here. */
  useEffect(() => {
    if (q.data?.groups) rememberCategories(q.data.groups);
    if (q.data?.subCategories) rememberSubCategories(q.data.subCategories);
  }, [q.data]);
  const read = useMemo(() => ({
    /** What a picker offers: the group's shown sub-categories, plus `keep` when a SKU already carries a hidden one. */
    pickable: (group: CatalogGroup, keep?: string | null) =>
      subCategoriesOf(group, all).filter((s) => s.active !== false || s.code === keep),
    label: (code: string | null | undefined): string => (code ? (all.find((s) => s.code === code)?.label ?? code) : ''),
    /** Units a picker offers: the shown ones, plus `keep` when a SKU or line already carries a hidden one. */
    pickableUoms: (keep?: string | null) => uoms.filter((u) => u.active !== false || u.code === keep),
    uomPrint: (code: string | null | undefined): string => uomPrintLabel(code, uoms),
  }), [all, uoms]);
  return { query: q, all, uoms, groups, canEdit: q.data?.canEdit ?? false, ...read };
}

/** The categories a filter or picker offers: the master list, or on a Houzs build the enum list.
    A stored legacy category (SOFA) falls under its group, so pair a client filter with categoryMatches. */
export function useCategoryOptions(): Array<{ value: string; label: string }> {
  const { groups } = useRenovationCatalog();
  return useMemo(
    () => (CONTS_RENOVATION_CATALOG
      ? groups.map((g) => ({ value: g.code, label: g.label }))
      : MFG_PRODUCT_CATEGORIES.map((c) => ({ value: c as string, label: mfgCategoryLabel(c) }))),
    [groups],
  );
}

/** The same list without a hook, for a static screen config; a caller that needs the fresh list also mounts useRenovationCatalog. */
export function categoryOptionsNow(): Array<{ value: string; label: string }> {
  if (!CONTS_RENOVATION_CATALOG) return MFG_PRODUCT_CATEGORIES.map((c) => ({ value: c as string, label: mfgCategoryLabel(c) }));
  const live = liveCategoryRows();
  return (live.length > 0 ? live : RENOVATION_GROUPS).map((g) => ({ value: g.code, label: g.label }));
}

/** Filter options plus any value the rows carry that no option covers (a renovation line's item group RENOVATION),
    so a row can always be reached. Pair with categoryMatches. */
export function withRowCategories(
  options: ReadonlyArray<{ value: string; label: string }>,
  stored: ReadonlyArray<string | null | undefined>,
): Array<{ value: string; label: string }> {
  const out = [...options];
  for (const raw of stored) {
    const v = String(raw ?? '').trim();
    if (v && !out.some((o) => categoryMatches(v, o.value))) out.push({ value: v, label: mfgCategoryLabel(v) });
  }
  return out;
}

/** Mounted once in the SCM shell so plain label lookups know the master list on every screen. Renders nothing. */
export function CategoryMasterSync() {
  useRenovationCatalog();
  return null;
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
