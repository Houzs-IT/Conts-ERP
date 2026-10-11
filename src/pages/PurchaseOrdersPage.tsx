import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Trash2, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useRecord, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { statusLabel } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';

/** Purchase Orders — ported from 2990's SCM (core priced document), drawn in Conts.
 *  Header + priced lines + status flow. Money is integer sen; the form takes RM. */

type Status = 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
const FILTERS: (Status | 'all')[] = ['all', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

interface Line { id?: string; itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; discountSen: number; lineTotalSen: number; receivedQty?: number }
interface Po {
  id: string; poNumber: string; supplierId: string; supplierCode: string; supplierName: string; status: Status;
  poDate: string; expectedAt: string; warehouseId: string; currency: string;
  subtotalSen: number; taxSen: number; totalSen: number; notes: string; lines?: Line[];
}
interface Payload { data: Po[]; generatedAt: string }
interface Opt { id: string; code: string; name: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'po1', poNumber: 'PO-2026-0001', supplierId: 's1', supplierCode: 'SUP-EMMA', supplierName: 'Emma Furnishings Sdn Bhd', status: 'SUBMITTED', poDate: '2026-09-18', expectedAt: '2026-10-02', warehouseId: 'w1', currency: 'MYR', subtotalSen: 984000, taxSen: 0, totalSen: 984000, notes: 'For Vista Jaya fit-out batch.', lines: [
      { itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qty: 2, unitPriceSen: 328000, discountSen: 0, lineTotalSen: 656000 },
      { itemCode: 'SF-2S-CHR', description: 'Emma 2-Seater Sofa, Charcoal', uom: 'UNIT', qty: 1, unitPriceSen: 328000, discountSen: 0, lineTotalSen: 328000 },
    ] },
    { id: 'po2', poNumber: 'PO-2026-0002', supplierId: 's2', supplierCode: 'SUP-HILTON', supplierName: 'Hilton Bedding Manufacturing', status: 'PARTIALLY_RECEIVED', poDate: '2026-09-15', expectedAt: '2026-09-28', warehouseId: 'w1', currency: 'MYR', subtotalSen: 840000, taxSen: 0, totalSen: 840000, notes: '', lines: [
      { itemCode: 'MT-KG-HIL', description: 'Hilton Pocket Spring Mattress, King', uom: 'UNIT', qty: 2, unitPriceSen: 420000, discountSen: 0, lineTotalSen: 840000, receivedQty: 1 },
    ] },
    { id: 'po3', poNumber: 'PO-2026-0003', supplierId: 's3', supplierCode: 'SUP-NORDIC', supplierName: 'Nordic Woodcraft', status: 'RECEIVED', poDate: '2026-09-05', expectedAt: '2026-09-19', warehouseId: 'w1', currency: 'MYR', subtotalSen: 378000, taxSen: 0, totalSen: 378000, notes: '', lines: [
      { itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qty: 2, unitPriceSen: 189000, discountSen: 0, lineTotalSen: 378000, receivedQty: 2 },
    ] },
  ],
};
const SUP_FALLBACK = { data: [
  { id: 's1', code: 'SUP-EMMA', name: 'Emma Furnishings Sdn Bhd' }, { id: 's2', code: 'SUP-HILTON', name: 'Hilton Bedding Manufacturing' },
  { id: 's3', code: 'SUP-NORDIC', name: 'Nordic Woodcraft' }, { id: 's4', code: 'SUP-TEXTILE', name: 'KL Textile & Carpet Co' },
] };
const WH_FALLBACK = { data: [{ id: 'w1', code: 'WH-MAIN', name: 'Main Warehouse' }, { id: 'w2', code: 'WH-KL', name: 'KL Transit Hub' }] };

export default function PurchaseOrdersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/purchase-orders', FALLBACK);
  const suppliers = useApi<{ data: Opt[] }>('/suppliers', SUP_FALLBACK).data?.data ?? [];
  const warehouses = useApi<{ data: Opt[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<Po | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [added, setAdded] = useState<Po[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Po>>>({});
  useResetOnReload(data, () => { setAdded([]); setEdits({}); });

  const all = useMemo(
    () => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })),
    [added, data, edits],
  );

  const q = search.trim().toLowerCase();
  const rows = all.filter(p =>
    (statusFilter === 'all' || p.status === statusFilter) &&
    (!q || `${p.poNumber} ${p.supplierName} ${p.supplierCode}`.toLowerCase().includes(q)),
  );

  const columns = useMemo<Column<Po>[]>(() => [
    { key: 'poNumber', label: 'PO number', type: 'ref', value: p => p.poNumber, hideable: false },
    { key: 'supplier', label: 'Supplier', value: p => p.supplierName, sub: p => p.supplierCode, text: p => `${p.supplierName} ${p.supplierCode}` },
    { key: 'poDate', label: 'PO date', type: 'date', value: p => p.poDate || null },
    { key: 'expectedAt', label: 'Expected', type: 'date', value: p => p.expectedAt || null },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'purchase_order' },
    { key: 'total', label: 'Total', type: 'money', value: p => p.totalSen },
  ], []);

  function openNew() {
    setIsNew(true);
    setDrawer({ id: '', poNumber: '', supplierId: suppliers[0]?.id ?? '', supplierCode: '', supplierName: '', status: 'SUBMITTED', poDate: new Date().toISOString().slice(0, 10), expectedAt: '', warehouseId: warehouses[0]?.id ?? '', currency: 'MYR', subtotalSen: 0, taxSen: 0, totalSen: 0, notes: '', lines: [] });
  }
  function openExisting(p: Po) { setIsNew(false); setDrawer({ ...p, lines: p.lines ?? [] }); }

  function saveNew(po: Po, lines: Line[]) {
    const supplier = suppliers.find(s => s.id === po.supplierId);
    const local: Po = { ...po, id: `po-new-${crypto.randomUUID().slice(0, 8)}`, poNumber: 'Saving…', supplierCode: supplier?.code ?? '', supplierName: supplier?.name ?? '', lines };
    setAdded(a => [local, ...a]);
    persist(api.post('/purchase-orders', body(po, lines)), { reload, ok: () => toast({ tone: 'success', title: 'Purchase order raised.', body: local.supplierName }) });
    setDrawer(null);
  }
  function saveEdit(po: Po, lines: Line[]) {
    const supplier = suppliers.find(s => s.id === po.supplierId);
    const patch: Partial<Po> = { ...totalsOf(lines, po.taxSen), supplierId: po.supplierId, supplierCode: supplier?.code ?? po.supplierCode, supplierName: supplier?.name ?? po.supplierName, expectedAt: po.expectedAt, warehouseId: po.warehouseId, notes: po.notes, poDate: po.poDate, lines };
    setEdits(e => ({ ...e, [po.id]: { ...e[po.id], ...patch } }));
    persist(api.patch(`/purchase-orders/${po.id}`, body(po, lines)), { reload, ok: () => toast({ tone: 'success', title: 'Purchase order updated.', body: po.poNumber }) });
    setDrawer(null);
  }
  function cancelPo(p: Po) {
    setEdits(e => ({ ...e, [p.id]: { ...e[p.id], status: 'CANCELLED' } }));
    persist(api.patch(`/purchase-orders/${p.id}`, { status: 'CANCELLED' }), { reload, ok: () => toast({ tone: 'success', title: 'Purchase order cancelled.', body: p.poNumber }) });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Purchase orders" sub={`${all.length} ${all.length === 1 ? 'order' : 'orders'} · buy-side documents`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={openNew}>New PO</Button> : undefined} />

      <DataTable<Po>
        id="scm.purchase-orders" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={openExisting}
        noun={['purchase order', 'purchase orders']} exportName="purchase-orders"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">
            {FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : statusLabel('purchase_order', f)} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}
          </div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO or supplier..." aria-label="Search purchase orders"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[260px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No purchase orders yet.', body: 'Raise a PO to order stock from a supplier.', action: canWrite ? { label: 'New PO', onClick: openNew } : undefined }} />

      {drawer && <PoDrawer po={drawer} isNew={isNew} suppliers={suppliers} warehouses={warehouses} canWrite={canWrite}
        onClose={() => setDrawer(null)} onCreate={saveNew} onSave={saveEdit} onCancelPo={cancelPo} />}
    </>
  );
}

function body(po: Po, lines: Line[]) {
  return {
    supplierId: po.supplierId, poDate: po.poDate, expectedAt: po.expectedAt || null, warehouseId: po.warehouseId || null,
    currency: po.currency, notes: po.notes, taxSen: po.taxSen,
    lines: lines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen, discountSen: l.discountSen, notes: '' })),
  };
}
function totalsOf(lines: Line[], taxSen: number) {
  const subtotalSen = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  return { subtotalSen, taxSen: Math.max(0, taxSen), totalSen: subtotalSen + Math.max(0, taxSen) };
}

/* ---------- primitives ---------- */

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid',
        active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>
  );
}

/* ---------- editor / viewer drawer ---------- */

interface DraftLine { itemCode: string; description: string; uom: string; qty: number | null; unitPriceSen: number | null; discountSen: number | null }
const toDraftLine = (l: Line): DraftLine => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen || null, discountSen: l.discountSen || null });
const blankLine = (): DraftLine => ({ itemCode: '', description: '', uom: 'UNIT', qty: 1, unitPriceSen: null, discountSen: null });
const lineTotal = (l: DraftLine) => Math.max(0, (l.qty ?? 0) * (l.unitPriceSen ?? 0) - (l.discountSen ?? 0));
const isKept = (l: DraftLine) => !!(l.itemCode.trim() && l.description.trim());

function PoDrawer({ po, isNew, suppliers, warehouses, canWrite, onClose, onCreate, onSave, onCancelPo }: {
  po: Po; isNew: boolean; suppliers: Opt[]; warehouses: Opt[]; canWrite: boolean;
  onClose: () => void; onCreate: (p: Po, l: Line[]) => void; onSave: (p: Po, l: Line[]) => void; onCancelPo: (p: Po) => void;
}) {
  const { record, loading: linesLoading, error: linesError } = useRecord<Po>('purchase-orders', isNew ? null : po.id);
  const editable = canWrite && (isNew || po.status === 'SUBMITTED') && !linesLoading && !linesError;
  const [h, setH] = useState<Po>(po);
  const [lines, setLines] = useState<DraftLine[]>((po.lines ?? []).map(toDraftLine));
  useEffect(() => { if (record?.lines) setLines(record.lines.map(toDraftLine)); }, [record]);
  const setHf = <K extends keyof Po>(k: K) => (e: { target: { value: string } }) => setH(s => ({ ...s, [k]: e.target.value as Po[K] }));
  const setLine = <K extends keyof DraftLine>(i: number, k: K, v: DraftLine[K]) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const [tried, setTried] = useState(false);
  const qtyError = (l: DraftLine) => (tried && isKept(l) && l.qty == null ? 'Required.' : undefined);

  const subtotal = !isNew && linesLoading ? po.subtotalSen : lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = subtotal + Math.max(0, h.taxSen);
  const built = (): Line[] => lines.filter(isKept).map(l => ({ itemCode: l.itemCode.trim(), description: l.description.trim(), uom: l.uom.trim() || 'UNIT', qty: l.qty ?? 0, unitPriceSen: l.unitPriceSen ?? 0, discountSen: l.discountSen ?? 0, lineTotalSen: lineTotal(l) }));
  const canSave = h.supplierId !== '' && built().length > 0;

  function submit() {
    setTried(true);
    if (lines.some(l => isKept(l) && l.qty == null)) return;
    const l = built();
    const next = { ...h, ...totalsOf(l, h.taxSen) };
    isNew ? onCreate(next, l) : onSave(next, l);
  }

  return (
    <Drawer open onClose={onClose} width={880}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New purchase order' : po.poNumber}</h2>
          {!isNew && <StatusBadge entity="purchase_order" value={po.status} />}
        </div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>

      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Supplier</label>
            <select value={h.supplierId} disabled={!editable} onChange={setHf('supplierId')}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-70">
              {suppliers.length === 0 && <option value="">No suppliers</option>}
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <DateField label="PO date" value={h.poDate} onChange={v => setH(s => ({ ...s, poDate: v }))} disabled={!editable} />
          <DateField label="Expected" value={h.expectedAt} min={h.poDate || undefined} onChange={v => setH(s => ({ ...s, expectedAt: v }))} disabled={!editable} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
            <select value={h.warehouseId} disabled={!editable} onChange={setHf('warehouseId')}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-70">
              <option value="">—</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>

        {/* Line editor */}
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines</div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[720px]">
              <thead><tr className="bg-muted">
                {['Item code', 'Description', 'UOM', 'Qty', 'Unit price', 'Discount', 'Line total', ''].map((th, i) => (
                  <th key={th || i} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i >= 3 && i <= 6 ? 'text-right' : 'text-left')}>{th}</th>
                ))}
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft)]">
                    <td className="p-1.5"><CellInput value={l.itemCode} onChange={v => setLine(i, 'itemCode', v)} disabled={!editable} w="130px" /></td>
                    <td className="p-1.5"><CellInput value={l.description} onChange={v => setLine(i, 'description', v)} disabled={!editable} w="100%" /></td>
                    <td className="p-1.5"><CellInput value={l.uom} onChange={v => setLine(i, 'uom', v)} disabled={!editable} w="70px" /></td>
                    <td className="p-1.5"><NumberInput aria-label="Quantity" value={l.qty} onChange={v => setLine(i, 'qty', v)} min={0} error={qtyError(l)} disabled={!editable} className={CELL} style={{ width: '64px' }} /></td>
                    <td className="p-1.5"><MoneyInput aria-label="Unit price" valueSen={l.unitPriceSen} onChangeSen={v => setLine(i, 'unitPriceSen', v)} disabled={!editable} className={CELL} style={{ width: '96px' }} /></td>
                    <td className="p-1.5"><MoneyInput aria-label="Discount" valueSen={l.discountSen} onChangeSen={v => setLine(i, 'discountSen', v)} disabled={!editable} className={CELL} style={{ width: '90px' }} /></td>
                    <td className="p-1.5 text-right tabular-nums text-[13px] whitespace-nowrap">{rm(lineTotal(l))}</td>
                    <td className="p-1.5 text-center">{editable && <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line" className="text-muted-ink hover:text-danger bg-transparent border-none cursor-pointer p-1"><Trash2 size={15} /></button>}</td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[12.5px] text-muted-ink">{linesLoading ? 'Loading lines…' : linesError ?? 'No lines yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {editable && <div><Button size="sm" variant="secondary" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setLines(ls => [...ls, blankLine()])}>Add line</Button></div>}
        </div>

        <div className="grid grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={h.notes} onChange={setHf('notes')} disabled={!editable} />
          <div className="flex flex-col gap-1.5 items-end justify-end">
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Subtotal</span><span className="tabular-nums w-[110px] text-right">{rm(subtotal)}</span></div>
            <div className="flex gap-8 text-[13px] items-center"><span className="text-muted-ink">Tax</span>
              <MoneyInput aria-label="Tax" disabled={!editable} valueSen={h.taxSen || null} onChangeSen={v => setH(s => ({ ...s, taxSen: v ?? 0 }))}
                className="h-8 w-[110px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70" /></div>
            <div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[110px] text-right">{rm(total)}</span></div>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{!isNew && canWrite && po.status !== 'CANCELLED' && po.status !== 'RECEIVED' &&
          <ConfirmButton confirm={{ title: `Cancel ${po.poNumber}?`, body: 'It is marked Cancelled and can no longer receive goods.', meta: po.supplierName, confirmLabel: 'Cancel PO', cancelLabel: 'Keep PO' }} onConfirm={() => onCancelPo(po)}>Cancel PO</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {editable && <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a supplier and add at least one line" onClick={submit}>{isNew ? 'Raise PO' : 'Save'}</Button>}
        </div>
      </div>
    </Drawer>
  );
}

const CELL = 'h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70 disabled:bg-transparent disabled:border-transparent';

function CellInput({ value, onChange, disabled, w }: { value: string; onChange: (v: string) => void; disabled?: boolean; w: string }) {
  return <input value={value} disabled={disabled} onChange={e => onChange(e.target.value)} style={{ width: w }} className={CELL} />;
}
