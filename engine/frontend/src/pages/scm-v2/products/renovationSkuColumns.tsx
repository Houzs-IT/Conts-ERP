/* Columns and small cells of the renovation SKU Master: photo, code, name,
   group, sub-category, unit, main supplier (the default PO party) and status.
   A photo-group SKU that is INACTIVE with no photo reads "Needs photo", which
   is the one thing standing between it and ACTIVE. */
import { ImageOff } from 'lucide-react';
import type { Column } from '../../../components/DataTable';
import { resolveApiAssetUrl } from '../../../components/scm-v2/PhotoGallery';
import type { MfgProductRow } from '../../../vendor/scm/lib/mfg-products-queries';
import {
  RENOVATION_GROUPS,
  categoryGroupOf,
  isPhotoRequiredCategory,
} from '../../../vendor/shared/renovation-catalog';
import { fmtSen } from '../../../vendor/shared/format';

export const groupLabel = (row: Pick<MfgProductRow, 'category' | 'category_group'>): string => {
  const g = row.category_group ?? categoryGroupOf(row.category);
  return RENOVATION_GROUPS.find((d) => d.code === g)?.label ?? String((row.category as string | null | undefined) ?? '');
};

/** A SKU that cannot be activated yet because its group needs a photo it lacks. */
export const skuNeedsPhoto = (row: Pick<MfgProductRow, 'category' | 'photoCount'>): boolean =>
  isPhotoRequiredCategory(row.category) && (row.photoCount ?? 0) === 0;

export function SkuStatusBadge({ row }: { row: MfgProductRow }) {
  if (row.status === 'ACTIVE') {
    return <span className="inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Active</span>;
  }
  if (skuNeedsPhoto(row)) {
    return <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Needs photo</span>;
  }
  return <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">Inactive</span>;
}

export function SkuThumb({ row, size = 40 }: { row: MfgProductRow; size?: number }) {
  const src = row.primaryThumbUrl ?? row.primaryPhotoUrl;
  const box = { width: size, height: size };
  if (!src) {
    const needed = isPhotoRequiredCategory(row.category);
    return (
      <span
        style={box}
        title={needed ? 'No photo yet' : 'Photos are not used for this group'}
        className={`inline-flex items-center justify-center rounded border ${needed ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-border bg-surface-2 text-ink-muted'}`}
      >
        <ImageOff size={14} strokeWidth={1.75} />
      </span>
    );
  }
  return <img src={resolveApiAssetUrl(src)} alt="" loading="lazy" style={box} className="rounded border border-border object-cover" />;
}

/* Export and Copy write the stored codes under the importer's own headings, so
   the exported sheet goes straight back in through Import SKUs unchanged. */
export function renovationSkuColumns(opts: {
  showCost: boolean;
  subLabel: (code: string | null | undefined) => string;
  uomPrint: (code: string | null | undefined) => string;
}): Column<MfgProductRow>[] {
  const { subLabel, uomPrint } = opts;
  const cols: Column<MfgProductRow>[] = [
    { key: 'photo', label: 'Photo', width: '64px', disableSort: true, disableFilter: true, render: (r) => <SkuThumb row={r} /> },
    { key: 'code', label: 'Product Code', exportLabel: 'code', width: '150px', getValue: (r) => r.code, render: (r) => <span className="font-money text-[13px]">{r.code}</span> },
    { key: 'name', label: 'Description', exportLabel: 'name', width: '260px', getValue: (r) => r.name, render: (r) => <span className="text-[13px]">{r.name}</span> },
    { key: 'group', label: 'Group', exportLabel: 'category', exportValue: (r) => r.category, width: '120px', getValue: (r) => groupLabel(r), render: (r) => groupLabel(r) },
    { key: 'sub', label: 'Sub-category', exportLabel: 'sub_category', exportValue: (r) => r.sub_category ?? '', width: '170px', getValue: (r) => subLabel(r.sub_category), render: (r) => subLabel(r.sub_category) || <span className="text-ink-muted">—</span> },
    { key: 'uom', label: 'Unit', exportLabel: 'uom', exportValue: (r) => r.uom ?? 'UNIT', width: '90px', getValue: (r) => uomPrint(r.uom ?? 'UNIT'), render: (r) => uomPrint(r.uom ?? 'UNIT') },
    {
      key: 'main',
      label: 'Main supplier',
      width: '200px',
      getValue: (r) => r.mainSupplierName ?? '',
      render: (r) =>
        r.mainSupplierName ? (
          <span className="text-[13px]">
            {r.mainSupplierName}
            {(r.supplierCount ?? 0) > 1 && <span className="text-ink-muted"> +{(r.supplierCount ?? 1) - 1}</span>}
          </span>
        ) : (r.supplierCount ?? 0) > 1 ? (
          <span className="text-[12px] text-amber-700">{r.supplierCount} suppliers, none main</span>
        ) : (
          <span className="text-[12px] text-ink-muted">No supplier</span>
        ),
    },
  ];
  if (opts.showCost) {
    cols.push({
      key: 'cost',
      label: 'Main cost',
      width: '110px',
      align: 'right',
      getValue: (r) => r.mainCostSen ?? null,
      render: (r) => (r.mainCostSen != null ? fmtSen(r.mainCostSen) : <span className="text-ink-muted">—</span>),
    });
  }
  cols.push({
    key: 'status',
    label: 'Status',
    exportLabel: 'status',
    exportValue: (r) => r.status,
    width: '110px',
    getValue: (r) => (r.status === 'ACTIVE' ? 'Active' : skuNeedsPhoto(r) ? 'Needs photo' : 'Inactive'),
    render: (r) => <SkuStatusBadge row={r} />,
  });
  return cols;
}
