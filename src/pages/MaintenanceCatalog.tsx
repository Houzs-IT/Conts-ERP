import { useMemo, useState, type ReactNode } from 'react';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { DataTable, type Column } from '../components/DataTable';
import { Select } from '../components/Select';
import { MoneyInput, NumberInput } from '../components/inputs';
// ---- Maintenance SKU catalog: the master list of repair items with a preset selling price.
// Shared by the catalog tab and the "pick a SKU" field in the create-job modal.

export interface Sku {
  id: string; code: string; name: string; category: SkuCategory; unitLabel: UnitLabel;
  defaultPrice: number | null; trackStock: boolean; stockOnHand: number; active: boolean; notes: string;
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
    { id: 'SKU-LIGHT', code: 'ELE-BULB', name: 'Change a lightbulb', category: 'electrical', unitLabel: 'unit', defaultPrice: 1500, trackStock: true, stockOnHand: 48, active: true, notes: 'Standard LED, in-house stock.' },
    { id: 'SKU-TAP', code: 'PLM-TAP', name: 'Replace kitchen tap', category: 'plumbing', unitLabel: 'job', defaultPrice: 12000, trackStock: true, stockOnHand: 6, active: true, notes: '' },
    { id: 'SKU-ACSVC', code: 'AC-SVC', name: 'Aircon service (per unit)', category: 'aircon', unitLabel: 'unit', defaultPrice: 8000, trackStock: false, stockOnHand: 0, active: true, notes: 'Quarterly. Gas top-up billed separately.' },
    { id: 'SKU-HEATER', code: 'PLM-HEATER', name: 'Water heater replacement', category: 'plumbing', unitLabel: 'job', defaultPrice: 64000, trackStock: true, stockOnHand: 2, active: true, notes: '' },
    { id: 'SKU-BLIND', code: 'FUR-BLIND', name: 'Replace roller blind', category: 'furniture', unitLabel: 'unit', defaultPrice: 22000, trackStock: true, stockOnHand: 0, active: true, notes: '' },
    { id: 'SKU-LABOUR', code: 'GEN-LABOUR', name: 'General handyman labour', category: 'general', unitLabel: 'hour', defaultPrice: 5000, trackStock: false, stockOnHand: 0, active: false, notes: 'Retired — use trade-specific SKUs.' },
  ],
};

export const INPUT_CX = 'block w-full box-border h-10 px-3 py-0 text-ink bg-white border border-solid border-line rounded-control outline-none font-sans text-copy font-normal';
export const LABEL_CX = 'text-meta font-medium text-muted-ink';

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
  code: string; name: string; category: SkuCategory; unitLabel: UnitLabel; defaultPrice: number;
  trackStock: boolean; stockOnHand: number; notes: string;
}

/** Stock tone: out of stock is critical, low (≤ 3) is a warning, otherwise a plain count. */
function stockTone(qty: number): 'critical' | 'warning' | 'neutral' {
  return qty <= 0 ? 'critical' : qty <= 3 ? 'warning' : 'neutral';
}

export function CatalogPanel({
  skus, loading, canWrite, onCreate, onUpdate,
}: {
  skus: Sku[]; loading: boolean; canWrite: boolean;
  /** Resolve to an error message to keep the dialog open with it, or null when saved. */
  onCreate: (input: CatalogInput) => Promise<string | null>;
  onUpdate: (id: string, patch: Partial<Sku>) => Promise<string | null>;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () => skus.filter(s => showInactive || s.active).sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code)),
    [skus, showInactive],
  );

  const columns = useMemo<Column<Sku>[]>(() => [
    { key: 'code', label: 'Code', type: 'ref', value: s => s.code, width: 120 },
    { key: 'name', label: 'Item', value: s => s.name, hideable: false, width: 240, sub: s => s.notes || null, render: s => <span className="font-semibold">{s.name}</span> },
    { key: 'category', label: 'Category', type: 'status', value: s => s.category, status: s => ({ label: CATEGORY_LABEL[s.category], tone: 'neutral' }), width: 120 },
    { key: 'price', label: 'Preset price', type: 'money', value: s => s.defaultPrice, sub: s => PER[s.unitLabel], width: 130 },
    { key: 'stock', label: 'In stock', type: 'number', value: s => (s.trackStock ? s.stockOnHand : null), width: 120,
      render: s => (s.trackStock ? <StatusBadge tone={stockTone(s.stockOnHand)} label={s.stockOnHand > 0 ? `${s.stockOnHand} in stock` : 'Out of stock'} size="sm" /> : <span className="text-muted-ink">Not stocked</span>) },
    { key: 'active', label: 'Status', type: 'status', value: s => (s.active ? 'active' : 'retired'), status: s => ({ label: s.active ? 'Active' : 'Retired', tone: s.active ? 'success' : 'warning' }), width: 110 },
    ...(canWrite ? [{ key: 'edit', label: '', noExport: true, sortable: false, filter: false as const, width: 80, align: 'right' as const,
      render: (s: Sku) => <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Edit</Button> }] : []),
  ], [canWrite]);
  const activeN = skus.filter(s => s.active).length;

  return (
    <div className="flex flex-col gap-3">
      <DataTable<Sku>
        id="maintenance.catalog" urlPrefix="cat." columns={columns} rows={loading && skus.length === 0 ? null : rows} rowKey={s => s.id}
        pageSize={0} noun={['item', 'items']} exportName="maintenance-catalog"
        rowTone={s => (s.active ? null : 'muted')} onRowClick={canWrite ? s => setEditing(s) : undefined}
        filtered={!showInactive && skus.length > 0} onClearFilters={() => setShowInactive(true)}
        toolbar={<span className="text-copy text-muted-ink">{activeN} active item{activeN === 1 ? '' : 's'} · a preset price seeds the quote when you raise a job.</span>}
        actions={<>
          <label className="flex items-center gap-1.5 text-meta text-muted-ink cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show retired
          </label>
          {canWrite && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New item</Button>}
        </>}
        empty={{ title: 'No catalog items yet', icon: 'Package',
          body: canWrite ? 'Add a repair item with a preset price, so picking it on a job fills the quote.' : 'Items appear here once someone in operations adds them.',
          action: canWrite ? { label: 'New item', onClick: () => setCreating(true) } : undefined }}
      />

      {creating && <SkuModal onClose={() => setCreating(false)} onSave={async input => { const err = await onCreate(input); if (!err) setCreating(false); return err; }} />}
      {editing && (
        <SkuModal sku={editing} onClose={() => setEditing(null)}
          onSave={async input => { const err = await onUpdate(editing.id, input); if (!err) setEditing(null); return err; }}
          onToggleActive={() => { void onUpdate(editing.id, { active: !editing.active }); setEditing(null); }} />
      )}
    </div>
  );
}

// ---- Add / edit a catalog item --------------------------------------------

function SkuModal({ sku, onClose, onSave, onToggleActive }: {
  sku?: Sku; onClose: () => void; onSave: (input: CatalogInput) => Promise<string | null>; onToggleActive?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [code, setCode] = useState(sku?.code ?? '');
  const [name, setName] = useState(sku?.name ?? '');
  const [category, setCategory] = useState<SkuCategory>(sku?.category ?? 'general');
  const [unitLabel, setUnitLabel] = useState<UnitLabel>(sku?.unitLabel ?? 'job');
  const [priceSen, setPriceSen] = useState<number | null>(sku?.defaultPrice ?? null);
  const [trackStock, setTrackStock] = useState(sku?.trackStock ?? false);
  const [stockQty, setStockQty] = useState<number | null>(sku?.stockOnHand ?? 0);
  const [notes, setNotes] = useState(sku?.notes ?? '');

  const stockOk = !trackStock || (stockQty != null && stockQty >= 0);
  const valid = code.trim() && name.trim() && priceSen != null && priceSen >= 0 && stockOk;

  async function submit() {
    if (!valid || priceSen == null || busy) return;
    setBusy(true); setSaveError(null);
    const err = await onSave({
      code: code.trim(), name: name.trim(), category, unitLabel, defaultPrice: priceSen,
      trackStock, stockOnHand: trackStock ? stockQty ?? 0 : 0, notes: notes.trim(),
    });
    setBusy(false); setSaveError(err);
  }

  return (
    <Modal title={sku ? 'Edit catalog item' : 'New catalog item'}
      sub="A repair item with a preset selling price. Picking it on a job fills the quote — still editable."
      onClose={onClose} width={520}
      footer={<>
        {sku && onToggleActive && (sku.active
          ? <ConfirmButton variant="secondary" onConfirm={onToggleActive} confirm={{ title: `Retire ${sku.name}?`,
              body: 'It can no longer be picked for new jobs. Jobs that already use it keep their price. You can restore it later.', confirmLabel: 'Retire' }}>Retire</ConfirmButton>
          : <Button size="sm" variant="secondary" onClick={onToggleActive}>Restore</Button>)}
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => void submit()} loading={busy} disabled={!valid} disabledReason={stockOk ? 'Add a code, name and price first.' : 'Enter how many are on hand.'}>
          {sku ? 'Save' : 'Add item'}
        </Button>
      </>}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
        <LabeledField label="Code"><input value={code} onChange={e => setCode(e.target.value)} placeholder="ELE-BULB" disabled={!!sku}
          className={cx(INPUT_CX, sku && 'opacity-60 cursor-not-allowed')} /></LabeledField>
        <LabeledField label="Preset price (RM)"><MoneyInput valueSen={priceSen} onChangeSen={setPriceSen} placeholder="15.00" aria-label="Preset price (RM)"
          className={INPUT_CX} /></LabeledField>
      </div>
      <LabeledField label="Name"><input value={name} onChange={e => setName(e.target.value)} placeholder="Change a lightbulb" className={INPUT_CX} /></LabeledField>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
        <Select size="md" showLabel label="Category" value={category} onChange={v => setCategory(v as SkuCategory)}
          options={CATEGORY_OPTIONS.map(c => ({ value: c, label: CATEGORY_LABEL[c] }))} />
        <Select size="md" showLabel label="Price is per" value={unitLabel} onChange={v => setUnitLabel(v as UnitLabel)}
          options={UNIT_LABEL_OPTIONS.map(u => ({ value: u, label: PER[u] }))} />
      </div>
      <div className="flex flex-col gap-[10px] px-3 py-[11px] rounded-control bg-page border border-solid border-line">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={trackStock} onChange={e => setTrackStock(e.target.checked)} />
          <span className="text-copy font-medium">Keep this part in stock</span>
        </label>
        {trackStock ? (
          <div className="flex items-center gap-2.5">
            <span className={LABEL_CX}>On hand</span>
            <NumberInput value={stockQty} onChange={setStockQty} min={0} aria-label="On hand"
              className={cx(INPUT_CX, 'w-24')} />
            <span className="text-meta text-muted-ink">A job can draw parts from this to exchange.</span>
          </div>
        ) : (
          <span className="text-meta text-muted-ink">Not stocked — jobs quote it but cannot draw it from a store.</span>
        )}
      </div>
      <LabeledField label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything the operator should know."
          className="block w-full box-border h-auto px-3 py-[10px] text-ink bg-white border border-solid border-line rounded-control outline-none font-sans text-copy font-normal resize-y leading-[1.5]" />
      </LabeledField>
      {saveError && <span className="text-meta text-danger" role="alert">{saveError}</span>}
    </Modal>
  );
}

// ---- Request to exchange: draw a stocked part from the store for a job -----

export function ExchangeModal({ jobLabel, skus, onClose, onExchange }: {
  jobLabel: string; skus: Sku[];
  onClose: () => void; onExchange: (sku: Sku, qty: number) => void;
}) {
  // Only stocked, active items with something on hand can be drawn.
  const available = skus.filter(s => s.active && s.trackStock && s.stockOnHand > 0);
  const [skuId, setSkuId] = useState(available[0]?.id ?? '');
  const [qty, setQty] = useState<number | null>(1);
  const sku = available.find(s => s.id === skuId) ?? null;
  const n = qty ?? 0;
  const valid = !!sku && n >= 1 && n <= sku.stockOnHand;

  return (
    <Modal title="Request to exchange" sub={`Draw a part from the maintenance store for ${jobLabel}.`} onClose={onClose} width={480}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => sku && valid && onExchange(sku, n)} disabled={!valid}
          disabledReason={!sku ? 'No stocked parts are available.' : n < 1 ? 'Enter how many.' : `Only ${sku.stockOnHand} in stock.`}>
          Draw from stock
        </Button>
      </>}>
      {available.length === 0 ? (
        <div className="px-3 py-[10px] rounded-control bg-page border border-solid border-line text-meta text-muted-ink">
          No stocked parts have any on hand. Mark an item "Keep this part in stock" in the catalog and set its quantity first.
        </div>
      ) : (
        <>
          <Select size="md" showLabel label="Part" value={skuId} onChange={setSkuId}
            options={available.map(s => ({ value: s.id, label: `${s.code} · ${s.name} · ${s.stockOnHand} in stock` }))} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px] items-end">
            <LabeledField label="Quantity">
              <NumberInput value={qty} onChange={setQty} min={1} max={sku?.stockOnHand} aria-label="Quantity" className={INPUT_CX} />
            </LabeledField>
            {sku && (
              n > sku.stockOnHand
                ? <div className="text-meta text-danger pb-2.5">Only {sku.stockOnHand} on hand.</div>
                : <div className="text-meta text-muted-ink pb-2.5">
                  {sku.stockOnHand} on hand → <span className="font-medium text-ink tabular-nums">{sku.stockOnHand - n}</span> after
                </div>
            )}
          </div>
          <div className="px-3 py-[10px] rounded-control bg-page border border-solid border-line text-meta text-muted-ink leading-[1.55]">
            This moves stock only. The part's selling price already reaches the owner statement through the job's quote when you complete it.
          </div>
        </>
      )}
    </Modal>
  );
}

// ---- Local modal shell (kept local to the maintenance domain) --------------

export function Modal({ title, sub, onClose, footer, children, width = 480 }: {
  title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div style={{ maxWidth: width }}
        className="relative w-full max-h-[90vh] overflow-y-auto bg-card rounded-card shadow-[var(--shadow-overlay)] animate-dialog">
        <div className="px-[22px] pt-[22px] pb-[18px] flex flex-col gap-1">
          <h2 className="m-0 text-title font-semibold text-pretty">{title}</h2>
          {sub && <p className="m-0 text-copy leading-[1.55] text-muted-ink text-pretty">{sub}</p>}
        </div>
        <div className="px-[22px] pt-0 pb-5 flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          {footer}
        </div>
      </div>
    </div>
  );
}

export function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={LABEL_CX}>{label}</label>
      {children}
    </div>
  );
}
