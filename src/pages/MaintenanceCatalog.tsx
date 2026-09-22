import { useMemo, useState, type ReactNode } from 'react';
import { cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { TableSkeleton } from '../components/DataState';
import { rm } from '../lib/format';

// ---- Maintenance SKU catalog: the master list of repair items with a preset selling price.
// Shared by the catalog tab and the "pick a SKU" field in the create-job modal.

export interface Sku {
  id: string; code: string; name: string; category: SkuCategory; unitLabel: UnitLabel;
  defaultPrice: number | null; active: boolean; notes: string;
}
export interface SkuPayload { data: Sku[]; generatedAt: string }

export type SkuCategory = 'plumbing' | 'electrical' | 'aircon' | 'furniture' | 'appliance' | 'cleaning' | 'general' | 'other';
export type UnitLabel = 'job' | 'unit' | 'hour';

export const CATEGORY_LABEL: Record<SkuCategory, string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', aircon: 'Aircon', furniture: 'Furniture',
  appliance: 'Appliance', cleaning: 'Cleaning', general: 'General', other: 'Other',
};
export const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL) as SkuCategory[];
export const UNIT_LABEL_OPTIONS: UnitLabel[] = ['job', 'unit', 'hour'];
const PER: Record<UnitLabel, string> = { job: 'per job', unit: 'per unit', hour: 'per hour' };

export const SKU_FALLBACK: SkuPayload = {
  generatedAt: '',
  data: [
    { id: 'SKU-LIGHT', code: 'ELE-BULB', name: 'Change a lightbulb', category: 'electrical', unitLabel: 'unit', defaultPrice: 1500, active: true, notes: 'Standard LED, in-house stock.' },
    { id: 'SKU-TAP', code: 'PLM-TAP', name: 'Replace kitchen tap', category: 'plumbing', unitLabel: 'job', defaultPrice: 12000, active: true, notes: '' },
    { id: 'SKU-ACSVC', code: 'AC-SVC', name: 'Aircon service (per unit)', category: 'aircon', unitLabel: 'unit', defaultPrice: 8000, active: true, notes: 'Quarterly. Gas top-up billed separately.' },
    { id: 'SKU-HEATER', code: 'PLM-HEATER', name: 'Water heater replacement', category: 'plumbing', unitLabel: 'job', defaultPrice: 64000, active: true, notes: '' },
    { id: 'SKU-BLIND', code: 'FUR-BLIND', name: 'Replace roller blind', category: 'furniture', unitLabel: 'unit', defaultPrice: 22000, active: true, notes: '' },
    { id: 'SKU-LABOUR', code: 'GEN-LABOUR', name: 'General handyman labour', category: 'general', unitLabel: 'hour', defaultPrice: 5000, active: false, notes: 'Retired — use trade-specific SKUs.' },
  ],
};

const INPUT_CX = 'block w-full box-border h-10 px-3 py-0 text-ink bg-white border border-solid border-line rounded-control outline-none font-sans text-[16px] font-normal';
const LABEL_CX = 'text-[12px] font-medium text-muted-ink';

const toSen = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** "1h 25m" / "45m" / "3h" — the gap between two stamps, for the job's duration. Null when it can't be shown. */
export function durationLabel(startedAt?: string | null, endedAt?: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '< 1m';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export interface CatalogInput {
  code: string; name: string; category: SkuCategory; unitLabel: UnitLabel; defaultPrice: number; notes: string;
}

export function CatalogPanel({
  skus, loading, canWrite, onCreate, onUpdate,
}: {
  skus: Sku[]; loading: boolean; canWrite: boolean;
  onCreate: (input: CatalogInput) => void;
  onUpdate: (id: string, patch: Partial<Sku>) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () => skus.filter(s => showInactive || s.active).sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code)),
    [skus, showInactive],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[13px] text-muted-ink">
          {skus.filter(s => s.active).length} active item{skus.filter(s => s.active).length === 1 ? '' : 's'} · a preset price seeds the quote when you raise a job.
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-[12px] text-muted-ink cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show retired
          </label>
          {canWrite && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New item</Button>}
        </div>
      </div>

      {loading && skus.length === 0 ? (
        <Card><TableSkeleton rows={4} cols={3} /></Card>
      ) : rows.length === 0 ? (
        <Card><div className="px-[22px] py-[28px] text-[13px]">No catalog items yet.{canWrite ? ' Add the first one.' : ''}</div></Card>
      ) : (
        <Card>
          {rows.map((s, idx) => (
            <div key={s.id} className={cx('px-5 py-[13px] flex items-center justify-between gap-4 flex-wrap',
              idx !== rows.length - 1 && '[border-bottom:1px_solid_var(--color-line-soft)]', !s.active && 'opacity-60')}>
              <div className="flex flex-col gap-[3px] min-w-[220px] flex-1">
                <div className="flex items-center gap-[9px] flex-wrap">
                  <span className="font-mono text-[11px] text-muted-ink">{s.code}</span>
                  <span className="text-[14px] font-semibold">{s.name}</span>
                  <Badge tone="neutral" label={CATEGORY_LABEL[s.category]} size="sm" />
                  {!s.active && <Badge tone="warning" label="Retired" size="sm" />}
                </div>
                {s.notes && <span className="text-[12px] text-muted-ink text-pretty">{s.notes}</span>}
              </div>
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-end">
                  <span className="text-[15px] font-semibold tabular-nums">{s.defaultPrice != null ? rm(s.defaultPrice) : '—'}</span>
                  <span className="text-[11px] text-muted-ink">{PER[s.unitLabel]}</span>
                </div>
                {canWrite && (
                  <button onClick={() => setEditing(s)}
                    className="h-8 px-3 py-0 rounded-control cursor-pointer [font:inherit] border border-solid border-line bg-white text-ink whitespace-nowrap">
                    Edit
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {creating && <SkuModal onClose={() => setCreating(false)} onSave={input => { onCreate(input); setCreating(false); }} />}
      {editing && (
        <SkuModal sku={editing} onClose={() => setEditing(null)}
          onSave={input => { onUpdate(editing.id, input); setEditing(null); }}
          onToggleActive={() => { onUpdate(editing.id, { active: !editing.active }); setEditing(null); }} />
      )}
    </div>
  );
}

// ---- Add / edit a catalog item --------------------------------------------

function SkuModal({ sku, onClose, onSave, onToggleActive }: {
  sku?: Sku; onClose: () => void; onSave: (input: CatalogInput) => void; onToggleActive?: () => void;
}) {
  const [code, setCode] = useState(sku?.code ?? '');
  const [name, setName] = useState(sku?.name ?? '');
  const [category, setCategory] = useState<SkuCategory>(sku?.category ?? 'general');
  const [unitLabel, setUnitLabel] = useState<UnitLabel>(sku?.unitLabel ?? 'job');
  const [price, setPrice] = useState(sku?.defaultPrice != null ? (sku.defaultPrice / 100).toFixed(2) : '');
  const [notes, setNotes] = useState(sku?.notes ?? '');

  const priceSen = toSen(price);
  const valid = code.trim() && name.trim() && priceSen != null && priceSen >= 0;

  function submit() {
    if (!valid || priceSen == null) return;
    onSave({ code: code.trim(), name: name.trim(), category, unitLabel, defaultPrice: priceSen, notes: notes.trim() });
  }

  return (
    <Modal title={sku ? 'Edit catalog item' : 'New catalog item'}
      sub="A repair item with a preset selling price. Picking it on a job fills the quote — still editable."
      onClose={onClose} width={520}
      footer={<>
        {sku && onToggleActive && (
          <Button size="sm" variant="secondary" onClick={onToggleActive}>{sku.active ? 'Retire' : 'Restore'}</Button>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={submit} disabled={!valid} disabledReason="Add a code, name and price first.">
          {sku ? 'Save' : 'Add item'}
        </Button>
      </>}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
        <LabeledField label="Code"><input value={code} onChange={e => setCode(e.target.value)} placeholder="ELE-BULB" disabled={!!sku}
          className={cx(INPUT_CX, sku && 'opacity-60 cursor-not-allowed')} /></LabeledField>
        <LabeledField label="Preset price (RM)"><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="15.00"
          className={cx(INPUT_CX, 'text-right tabular-nums')} /></LabeledField>
      </div>
      <LabeledField label="Name"><input value={name} onChange={e => setName(e.target.value)} placeholder="Change a lightbulb" className={INPUT_CX} /></LabeledField>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
        <LabeledField label="Category">
          <select value={category} onChange={e => setCategory(e.target.value as SkuCategory)} className={INPUT_CX}>
            {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="Price is per">
          <select value={unitLabel} onChange={e => setUnitLabel(e.target.value as UnitLabel)} className={INPUT_CX}>
            {UNIT_LABEL_OPTIONS.map(u => <option key={u} value={u}>{PER[u]}</option>)}
          </select>
        </LabeledField>
      </div>
      <LabeledField label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything the operator should know."
          className="block w-full box-border h-auto px-3 py-[10px] text-ink bg-white border border-solid border-line rounded-control outline-none font-sans text-[16px] font-normal resize-y leading-[1.5]" />
      </LabeledField>
    </Modal>
  );
}

// ---- Local modal shell (kept local to the maintenance domain) --------------

function Modal({ title, sub, onClose, footer, children, width = 480 }: {
  title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div style={{ maxWidth: width }}
        className="relative w-full max-h-[90vh] overflow-y-auto bg-white rounded-card shadow-[var(--shadow-overlay)] animate-dialog">
        <div className="px-[22px] pt-[22px] pb-[18px] flex flex-col gap-1">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold text-pretty">{title}</h2>
          {sub && <p className="m-0 text-[13px] leading-[1.55] text-muted-ink text-pretty">{sub}</p>}
        </div>
        <div className="px-[22px] pt-0 pb-5 flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          {footer}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={LABEL_CX}>{label}</label>
      {children}
    </div>
  );
}
