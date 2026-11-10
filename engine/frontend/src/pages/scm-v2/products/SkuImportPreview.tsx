/* The Import SKUs preview: what the file WOULD do, as the server judged it
   against the database (dryRun). New rows, changed rows field by field (old to
   new), and how many rows already match. Nothing is written until Confirm
   (Hookka d36177ca0 / 2b04557df, TODO port item 10). */
import type { BatchImportPlan, SkuImportChange } from '../../../vendor/scm/lib/mfg-products-queries';
import { fmtSen } from '../../../vendor/shared/format';
import { mfgCategoryLabel } from '../../../vendor/shared/product-categories';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  category: 'Group',
  sub_category: 'Sub-category',
  uom: 'Unit',
  status: 'Status',
  description: 'Description',
  base_model: 'Model',
  size_label: 'Size',
  branding: 'Branding',
  base_price_sen: 'Base price',
  price1_sen: 'Price 1',
  unit_m3_milli: 'Volume (m³ x 1000)',
  seat_height_prices: 'Sofa prices',
};

const MONEY = new Set(['base_price_sen', 'price1_sen']);

function shown(field: string, v: unknown): string {
  if (v == null || v === '') return '(blank)';
  if (MONEY.has(field)) return fmtSen(Number(v));
  if (field === 'category') return mfgCategoryLabel(String(v));
  if (field === 'status') return String(v).toUpperCase() === 'ACTIVE' ? 'Active' : 'Inactive';
  return String(v);
}

/* One change in plain words, e.g. "Base price: RM 100.00 → RM 125.00". */
export function describeSkuChange(c: SkuImportChange): string {
  const label = FIELD_LABELS[c.field] ?? c.field;
  if (c.field === 'seat_height_prices') return `${label}: updated`;
  return `${label}: ${shown(c.field, c.from)} → ${shown(c.field, c.to)}`;
}

/* The one-line count, e.g. "2 new · 3 changed · 40 unchanged". */
export function planSummary(counts: BatchImportPlan['counts']): string {
  return [`${counts.new} new`, `${counts.changed} changed`, `${counts.unchanged} unchanged`].join(' · ');
}

const LIST_MAX = 50;

export function SkuImportPreview({ plan, skipped }: { plan: BatchImportPlan; skipped: Array<{ code: string; reason: string }> }) {
  const created = plan.plan.filter((p) => p.status === 'new');
  const changed = plan.plan.filter((p) => p.status === 'changed');
  const failures = [...skipped, ...plan.failures];
  const box = { maxHeight: 220, overflowY: 'auto' as const, margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-4)', fontSize: 'var(--fs-12)' };
  return (
    <div style={{ fontSize: 'var(--fs-13)' }}>
      <p><strong>{planSummary(plan.counts)}</strong>
        {failures.length > 0 && <> · <span style={{ color: '#b3261e' }}>{failures.length} will be skipped</span></>}
      </p>
      {changed.length > 0 && (
        <>
          <div style={{ marginTop: 'var(--space-2)', fontWeight: 600 }}>Changed</div>
          <ul style={box}>
            {changed.slice(0, LIST_MAX).map((p, i) => (
              <li key={`${p.code}-${i}`}>
                <span className="font-money">{p.code}</span>{p.name ? ` ${p.name}` : ''}
                <ul style={{ paddingLeft: 'var(--space-3)', color: '#4b5045' }}>
                  {p.changes.map((c) => <li key={c.field}>{describeSkuChange(c)}</li>)}
                </ul>
              </li>
            ))}
            {changed.length > LIST_MAX && <li>…and {changed.length - LIST_MAX} more</li>}
          </ul>
        </>
      )}
      {created.length > 0 && (
        <>
          <div style={{ marginTop: 'var(--space-2)', fontWeight: 600 }}>New</div>
          <ul style={box}>
            {created.slice(0, LIST_MAX).map((p, i) => (
              <li key={`${p.code}-${i}`}><span className="font-money">{p.code}</span>{p.name ? ` ${p.name}` : ''}</li>
            ))}
            {created.length > LIST_MAX && <li>…and {created.length - LIST_MAX} more</li>}
          </ul>
        </>
      )}
      {(plan.modelsToMove ?? []).length > 0 && (
        <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-12)' }}>
          Moves model{plan.modelsToMove!.length === 1 ? '' : 's'}{' '}
          {plan.modelsToMove!.map((m) => `${m.modelCode} (${mfgCategoryLabel(m.from)} → ${mfgCategoryLabel(m.to)})`).join(', ')} with all their SKUs.
        </p>
      )}
      {failures.length > 0 && (
        <ul style={{ ...box, color: '#b3261e' }}>
          {failures.slice(0, 8).map((e, i) => <li key={`${e.code}-${i}`}>{e.code || '(no code)'}: {e.reason}</li>)}
          {failures.length > 8 && <li>…and {failures.length - 8} more</li>}
        </ul>
      )}
      <p style={{ marginTop: 'var(--space-2)', color: '#767b6e', fontSize: 'var(--fs-12)' }}>
        A blank cell keeps the stored value. Unchanged rows are not written. <strong>Nothing is saved until you confirm.</strong>
      </p>
    </div>
  );
}
