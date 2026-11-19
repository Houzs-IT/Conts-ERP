/* The Packages module (owner, 20 Nov 2026): packages (PKG-, areas) and kits (KIT-) of products, quantities and SLA days.
   Backend: engine/backend/src/scm/routes/renovation-packages.ts. A package holds no prices: the screens show today's SKU
   Master selling price as a reference, and lines added to a sales order take the SKU price of that moment. */

import { useQuery } from '@tanstack/react-query';
import { renoGet, renoSend, sectionsForSave, type DocLine, type DocSection } from './api';

export type PackageKind = 'PACKAGE' | 'KIT';
export type PackageStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';

export const KIND_LABEL: Record<PackageKind, string> = { PACKAGE: 'Package', KIT: '组合' };
export const KIND_LONG: Record<PackageKind, string> = { PACKAGE: 'Package (areas, a whole unit)', KIT: '组合 (a few items together)' };
export const STATUS_LABEL: Record<PackageStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', INACTIVE: 'Inactive' };

export interface PackageRow {
  id: string; code: string; kind: PackageKind; name: string; building: string; unitType: string; salesNote: string; status: PackageStatus;
  updatedAt: string; createdAt: string; areas: number; lines: number; totalSen: number; slaSet: boolean; used: number;
}

export interface PackageLine extends DocLine { skuName?: string | null; skuPriceSen?: number | null; skuActive?: boolean | null }
export interface PackageSection extends Omit<DocSection, 'lines'> { lines: PackageLine[] }

export interface PackageView {
  id: string; code: string; kind: PackageKind; name: string; building: string; unitType: string; salesNote: string; status: PackageStatus;
  updatedAt: string; createdAt: string; sections: PackageSection[]; totalSen: number; slaSet: boolean;
  usedIn: Array<{ voId: string; voNo: string; soDocNo: string; status: string; docDate: string; project: string | null; lines: number }>;
  history: Array<{ at: string; who: string | null; action: string; note: string | null }>;
}

export interface PackageHit {
  id: string; code: string; kind: PackageKind; name: string; building: string; areas: number; lines: number; totalSen: number;
  areaNames: string[]; itemCodes: string[];
}

export interface ExpandedPackage {
  id: string; code: string; kind: PackageKind; name: string; status: PackageStatus;
  sections: Array<Omit<DocSection, 'lines'> & { lines: Array<DocLine & { skuActive?: boolean | null }> }>;
}

export const pkgKeys = {
  list: ['reno', 'packages'] as const,
  one: (id: string) => ['reno', 'package', id] as const,
};

export function usePackages() {
  return useQuery({ queryKey: pkgKeys.list, queryFn: () => renoGet<{ packages: PackageRow[] }>('/packages'), staleTime: 30_000 });
}

export function usePackage(id: string | undefined) {
  return useQuery({ queryKey: pkgKeys.one(id ?? ''), queryFn: () => renoGet<PackageView>(`/packages/${encodeURIComponent(id!)}`), enabled: Boolean(id) });
}

export const searchPackages = (q: string) => renoGet<{ packages: PackageHit[] }>(`/packages/search?q=${encodeURIComponent(q)}`);
export const expandPackage = (id: string) => renoGet<ExpandedPackage>(`/packages/${encodeURIComponent(id)}/expand`);
export const nextPackageCode = (kind: PackageKind) => renoGet<{ code: string }>(`/packages/next-code?kind=${kind}`);

export interface PackageSave {
  kind?: PackageKind; code?: string; name?: string; building?: string; unitType?: string; salesNote?: string; status?: PackageStatus;
  sections?: DocSection[]; fromSoDocNo?: string;
}

const body = (b: PackageSave) => ({ ...b, sections: b.sections ? sectionsForSave(b.sections.map(forPackage)) : undefined });

export const createPackage = (b: PackageSave) => renoSend<{ id: string; code: string }>('/packages', 'POST', body(b));
export const savePackage = (id: string, b: PackageSave) => renoSend<{ ok: true }>(`/packages/${encodeURIComponent(id)}`, 'PUT', body(b));

/** A package keeps products, quantities and SLA days: prices, costs and suppliers are not sent (the server drops them too). */
export function forPackage(s: DocSection): DocSection {
  return {
    ...s, lumpSumSen: null,
    lines: s.lines.map((l) => ({ ...l, unitPriceSen: 0, listPriceSen: null, discountBp: 0, amountOverrideSen: null, isFoc: false, unitCostSen: 0, supplierId: null, fromPackageId: null, voChange: null, omitTargetLineId: null, omitQty: null })),
  };
}

export const NO_AREA = '(no area)';

/** Product lines of a structure (items and add-ons). */
export const productLinesOf = <L extends Pick<DocLine, 'kind'>>(sections: Array<{ lines: L[] }>): L[] =>
  sections.flatMap((s) => s.lines.filter((l) => l.kind === 'ITEM' || l.kind === 'CHILD'));

/** The package's reference value: today's SKU price times quantity. */
export const refTotal = (sections: Array<{ lines: PackageLine[] }>): number =>
  productLinesOf(sections).reduce((t, l) => t + (l.skuPriceSen ?? 0) * (l.qty || 0), 0);
