import { todayMyt } from '../lib/format';
import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';

/** Stock — ported from 2990's SCM inventory (quantity-only first cut). On-hand is the
 *  running sum of the movement ledger. FIFO cost layers + GRN/DO auto-wiring deferred. */

interface OnHand { itemCode: string; itemName: string; warehouseId: string; warehouseCode: string; warehouseName: string; onHand: number }
interface Movement { id: string; itemCode: string; warehouseName: string; qtyDelta: number; movementType: string; refType: string; note: string; movedAt: string }
interface Opt { id: string; code: string; name: string }

const OH_FALLBACK: { data: OnHand[] } = { data: [
  { itemCode: 'BF-KG-OAK', itemName: 'Nordic Bedframe, Oak', warehouseId: 'w1', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse', onHand: 2 },
  { itemCode: 'MT-KG-HIL', itemName: 'Hilton Pocket Spring Mattress', warehouseId: 'w1', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse', onHand: 1 },
  { itemCode: 'SF-3S-GRY', itemName: 'Emma 3-Seater Sofa', warehouseId: 'w1', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse', onHand: 4 },
] };
const MV_FALLBACK: { data: Movement[] } = { data: [
  { id: 'm1', itemCode: 'BF-KG-OAK', warehouseName: 'Main Warehouse', qtyDelta: 2, movementType: 'RECEIPT', refType: 'GRN', note: '', movedAt: '2026-09-19' },
  { id: 'm2', itemCode: 'SF-3S-GRY', warehouseName: 'Main Warehouse', qtyDelta: 4, movementType: 'ADJUSTMENT', refType: 'ADJ', note: 'Opening count', movedAt: '2026-09-15' },
] };
const WH_FALLBACK = { data: [{ id: 'w1', code: 'WH-MAIN', name: 'Main Warehouse' }, { id: 'w2', code: 'WH-KL', name: 'KL Transit Hub' }] };

const REF_LABEL: Record<string, string> = { GRN: 'Goods receipt', DO: 'Delivery order', ADJ: 'Adjustment', TRF: 'Transfer', STK: 'Stock take', PRET: 'Purchase return', SRET: 'Delivery return' };
const MV_LABEL: Record<string, string> = { RECEIPT: 'Receipt', ISSUE: 'Issue', ADJUSTMENT: 'Adjustment', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', RETURN: 'Return', STOCK_TAKE: 'Stock take' };

export default function StockPage() {
  const { data, loading, error, reload } = useApi<{ data: OnHand[] }>('/stock', OH_FALLBACK);
  const moves = useApi<{ data: Movement[] }>('/stock/movements', MV_FALLBACK);
  const warehouses = useApi<{ data: Opt[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [tab, setTab] = useState<'onhand' | 'moves'>('onhand');
  const [whFilter, setWhFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [added, setAdded] = useState<Movement[]>([]);
  useResetOnReload(moves.data, () => setAdded([]));

  const q = search.trim().toLowerCase();
  const onhand = (data?.data ?? []).filter(r => (whFilter === 'all' || r.warehouseId === whFilter) && (!q || `${r.itemCode} ${r.itemName}`.toLowerCase().includes(q)));
  const movements = [...added, ...(moves.data?.data ?? [])].filter(m => !q || m.itemCode.toLowerCase().includes(q));
  const totalUnits = onhand.reduce((s, r) => s + r.onHand, 0);

  const onhandColumns = useMemo<Column<OnHand>[]>(() => [
    { key: 'item', label: 'Item code', type: 'ref', value: r => r.itemCode, hideable: false },
    { key: 'name', label: 'Description', value: r => r.itemName, width: 220 },
    { key: 'warehouse', label: 'Warehouse', value: r => r.warehouseName, filter: { kind: 'select' } },
    { key: 'onhand', label: 'On hand', type: 'number', value: r => r.onHand,
      render: r => <span className={cx('tabular-nums font-semibold', r.onHand < 0 ? 'text-danger' : '')}>{r.onHand}</span> },
  ], []);
  const moveColumns = useMemo<Column<Movement>[]>(() => [
    { key: 'date', label: 'Date', type: 'date', value: m => m.movedAt },
    { key: 'item', label: 'Item code', type: 'ref', value: m => m.itemCode, hideable: false },
    { key: 'warehouse', label: 'Warehouse', value: m => m.warehouseName, filter: { kind: 'select' } },
    { key: 'type', label: 'Type', value: m => MV_LABEL[m.movementType] ?? m.movementType, filter: { kind: 'select' } },
    { key: 'ref', label: 'Source', value: m => REF_LABEL[m.refType] ?? m.refType, width: 140 },
    { key: 'qty', label: 'Qty', type: 'number', value: m => m.qtyDelta, width: 90,
      render: m => <span className={cx('tabular-nums font-semibold', m.qtyDelta < 0 ? 'text-danger' : 'text-success')}>{m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}</span> },
    { key: 'note', label: 'Note', value: m => m.note, width: 200 },
  ], []);

  const tabs = (
    <div className="px-[22px] max-md:px-4 pt-4">
      <Segmented label="View" options={[{ key: 'onhand', label: 'On hand' }, { key: 'moves', label: 'Movements' }]} value={tab} onChange={setTab} />
    </div>
  );
  const whSelect = (
    <select value={whFilter} onChange={e => setWhFilter(e.target.value)} aria-label="Warehouse" className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
      <option value="all">All warehouses</option>
      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
  const searchBox = (
    <div className="relative">
      <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
      <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item code..." aria-label="Search stock"
        className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
    </div>
  );

  function adjusted(m: Movement, req: Promise<unknown>) {
    setAdded(a => [m, ...a]); setAdjusting(false);
    persist(req, { reload: () => { reload(); moves.reload(); }, ok: () => toast({ tone: 'success', title: 'Stock adjusted.', body: `${m.itemCode} ${m.qtyDelta > 0 ? '+' : ''}${m.qtyDelta}` }) });
  }

  return (
    <>
      <PageHeader title="Stock" sub={data ? `${onhand.length} ${onhand.length === 1 ? 'line' : 'lines'} · ${totalUnits} units on hand` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setAdjusting(true)}>Stock adjustment</Button> : undefined} />

      {tab === 'onhand' ? (
        <DataTable<OnHand>
          id="scm.stock" urlPrefix="onhand." columns={onhandColumns} rows={data ? onhand : null} rowKey={r => `${r.itemCode}-${r.warehouseId}`}
          loading={loading} error={error} onRetry={reload} pageSize={0}
          noun={['stock line', 'stock lines']} exportName="stock-on-hand"
          header={tabs} toolbar={<>{whSelect}{searchBox}</>}
          filtered={!!q || whFilter !== 'all'} onClearFilters={() => { setSearch(''); setWhFilter('all'); }}
          empty={{ title: 'No stock on hand.' }} />
      ) : (
        <DataTable<Movement>
          id="scm.stock-movements" urlPrefix="moves." columns={moveColumns} rows={moves.data ? movements : null} rowKey={m => m.id}
          loading={moves.loading} error={moves.error} onRetry={moves.reload} pageSize={0}
          noun={['movement', 'movements']} exportName="stock-movements"
          header={tabs} toolbar={searchBox}
          filtered={!!q} onClearFilters={() => setSearch('')}
          empty={{ title: 'No movements yet.' }} />
      )}

      {adjusting && <AdjustDrawer warehouses={warehouses} canWrite={canWrite} onClose={() => setAdjusting(false)} onDone={adjusted} />}
    </>
  );
}


function AdjustDrawer({ warehouses, canWrite, onClose, onDone }: { warehouses: Opt[]; canWrite: boolean; onClose: () => void; onDone: (m: Movement, req: Promise<unknown>) => void }) {
  const [itemCode, setItemCode] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [qty, setQty] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const qtyDelta = qty ?? 0;
  const canSave = canWrite && itemCode.trim() !== '' && warehouseId !== '' && qtyDelta !== 0;

  function submit() {
    const req = api.post('/stock', { itemCode: itemCode.trim(), warehouseId, qtyDelta, note });
    const wh = warehouses.find(w => w.id === warehouseId);
    onDone({ id: `mv-new-${crypto.randomUUID().slice(0, 8)}`, itemCode: itemCode.trim(), warehouseName: wh?.name ?? '', qtyDelta, movementType: 'ADJUSTMENT', refType: 'ADJ', note, movedAt: todayMyt() }, req);
  }

  return (
    <Drawer open onClose={onClose} width={480}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">Stock adjustment</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-2 gap-3.5">
          <div className="col-span-2"><Field label="Item code" placeholder="e.g. SF-3S-GRY" value={itemCode} onChange={e => setItemCode(e.target.value)} /></div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <NumberInput label="Quantity change (+/−)" allowNegative placeholder="e.g. -1 or 5" value={qty} onChange={setQty} help="Positive to add stock, negative to remove." />
          <div className="col-span-2"><Field label="Note" placeholder="Reason for the adjustment" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an item, warehouse and a non-zero quantity" onClick={submit}>Post adjustment</Button>
      </div>
    </Drawer>
  );
}
