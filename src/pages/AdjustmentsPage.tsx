import { mayWork } from '../lib/areaAccess';
import { todayMyt } from '../lib/format';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { TONE, cx } from '../lib/design-tokens';
import { CloseButton } from '../components/CloseButton';

/** Stock Adjustments — ported from 2990's SCM inventory adjustments, drawn in Conts. A manual
 *  stock ADJUSTMENT posts a signed movement to the ledger (the write the "Adjustments" tab
 *  makes). This lists those movements + raises new ones. */

interface Mv { id: string; itemCode: string; warehouseId: string; warehouseCode: string; warehouseName: string; qtyDelta: number; note: string; movedAt: string }
interface Payload { data: Mv[]; generatedAt: string }
interface Wh { id: string; code: string; name: string }

const WH_FALLBACK: { data: Wh[] } = { data: [
  { id: 'wh1', code: 'WH-MAIN', name: 'Main Warehouse' }, { id: 'wh2', code: 'WH-KL', name: 'KL Showroom Store' },
] };
const FALLBACK: Payload = { generatedAt: '', data: [
  { id: 'm1', itemCode: 'SF-3S-GRY', warehouseId: 'wh1', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse', qtyDelta: -1, note: 'Damaged in storage', movedAt: '2026-09-22' },
  { id: 'm2', itemCode: 'MT-KG-HIL', warehouseId: 'wh1', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse', qtyDelta: 2, note: 'Stock-take correction', movedAt: '2026-09-20' },
] };

const REASONS = ['Stock-take correction', 'Damaged', 'Lost', 'Found', 'Sample / display', 'Opening balance', 'Other'];

export default function AdjustmentsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/stock/movements?type=ADJUSTMENT', FALLBACK);
  const warehouses = useApi<{ data: Wh[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayWork(user, 'scWarehouse');
  const [whFilter, setWhFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [added, setAdded] = useState<Mv[]>([]);

  const all = useMemo(() => [...added, ...(data?.data ?? [])], [added, data]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(m => (whFilter === 'all' || m.warehouseId === whFilter) && (!q || `${m.itemCode} ${m.note}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Mv>[]>(() => [
    { key: 'date', label: 'Date', type: 'date', value: m => m.movedAt || null },
    { key: 'item', label: 'Item', type: 'ref', value: m => m.itemCode, hideable: false },
    { key: 'warehouse', label: 'Warehouse', value: m => m.warehouseName || m.warehouseCode || null },
    { key: 'change', label: 'Change', type: 'number', value: m => m.qtyDelta, render: m => <span className={cx('tabular-nums text-[13px] font-semibold', m.qtyDelta > 0 ? TONE.success.text : TONE.critical.text)}>{m.qtyDelta > 0 ? '+' : ''}{m.qtyDelta}</span> },
    { key: 'reason', label: 'Reason', value: m => m.note || null, render: m => <span className="text-[12.5px] text-muted-ink">{m.note || '—'}</span> },
  ], []);

  // Waits for the server: a refused adjustment (e.g. more out than is on hand) must not show as posted.
  async function create(m: Mv): Promise<Record<string, string> | undefined> {
    try {
      const r = await api.post<{ id: string }>('/stock', { itemCode: m.itemCode, warehouseId: m.warehouseId, qtyDelta: m.qtyDelta, note: m.note });
      setAdded(a => [{ ...m, id: r.id }, ...a]);
      toast({ tone: 'success', title: 'Adjustment posted.', body: `${m.itemCode} ${m.qtyDelta > 0 ? '+' : ''}${m.qtyDelta}` });
      setDrawer(false);
    } catch (e) { notifyFailure(e); return e instanceof ApiFailure ? e.fields : undefined; }
  }

  return (
    <>
      <PageHeader title="Adjustments" sub={data ? `${all.length} ${all.length === 1 ? 'stock adjustment' : 'stock adjustments'}` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(true)}>New adjustment</Button> : undefined} />
      <DataTable<Mv>
        id="scm.adjustments" columns={columns} rows={data ? rows : null} rowKey={m => m.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['adjustment', 'adjustments']} exportName="stock-adjustments"
        toolbar={<>
          <div className="flex items-center gap-2.5">
            <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
            <select value={whFilter} onChange={e => setWhFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="all">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </div>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item / reason..." aria-label="Search adjustments"
            className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
        </>}
        filtered={!!q || whFilter !== 'all'} onClearFilters={() => { setSearch(''); setWhFilter('all'); }}
        empty={{ title: 'No adjustments yet.', body: 'Post a manual correction to on-hand stock — it lands in the movement ledger.', action: canWrite ? { label: 'New adjustment', onClick: () => setDrawer(true) } : undefined }} />
      {drawer && <AdjustDrawer warehouses={warehouses} canWrite={canWrite} onClose={() => setDrawer(false)} onCreate={create} />}
    </>
  );
}

function AdjustDrawer({ warehouses, canWrite, onClose, onCreate }: { warehouses: Wh[]; canWrite: boolean; onClose: () => void; onCreate: (m: Mv) => Promise<Record<string, string> | undefined> }) {
  const [busy, setBusy] = useState(false);
  const [itemCode, setItemCode] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [qty, setQty] = useState<number | null>(1);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const magnitude = qty ?? 0;
  const canSave = canWrite && itemCode.trim() !== '' && warehouseId !== '' && magnitude > 0;

  async function submit() {
    const wh = warehouses.find(w => w.id === warehouseId);
    const delta = direction === 'in' ? magnitude : -magnitude;
    const fullNote = note.trim() ? `${reason} — ${note.trim()}` : reason;
    setBusy(true);
    setFields({});
    const refused = await onCreate({ id: '', itemCode: itemCode.trim(), warehouseId, warehouseCode: wh?.code ?? '', warehouseName: wh?.name ?? '', qtyDelta: delta, note: fullNote, movedAt: todayMyt() });
    setFields(refused ?? {});
    setBusy(false);
  }

  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">New stock adjustment</h2><CloseButton onClick={onClose} /></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <Field label="Item code" placeholder="e.g. SF-3S-GRY" value={itemCode} onChange={e => setItemCode(e.target.value)} />
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Direction</label>
            <select value={direction} onChange={e => setDirection(e.target.value as 'in' | 'out')} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="in">Increase (+)</option><option value="out">Decrease (−)</option>
            </select>
          </div>
          <NumberInput label="Quantity" min={1} value={qty} onChange={setQty} error={fields.qtyDelta} />
        </div>
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <Field label="Note" placeholder="Optional detail" value={note} onChange={e => setNote(e.target.value)} />
        <div className="text-[12.5px] text-muted-ink">Posts <span className={cx('font-semibold', direction === 'in' ? TONE.success.text : TONE.critical.text)}>{direction === 'in' ? '+' : '−'}{magnitude}</span> to the stock ledger for <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{itemCode || '—'}</span>.</div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an item, warehouse and quantity" loading={busy} onClick={() => void submit()}>Post adjustment</Button>
      </div>
    </Drawer>
  );
}
