import { useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
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

  const q = search.trim().toLowerCase();
  const onhand = (data?.data ?? []).filter(r => (whFilter === 'all' || r.warehouseId === whFilter) && (!q || `${r.itemCode} ${r.itemName}`.toLowerCase().includes(q)));
  const movements = [...added, ...(moves.data?.data ?? [])].filter(m => !q || m.itemCode.toLowerCase().includes(q));
  const totalUnits = onhand.reduce((s, r) => s + r.onHand, 0);

  function adjusted(m: Movement) { setAdded(a => [m, ...a]); toast({ tone: 'success', title: 'Stock adjusted.', body: `${m.itemCode} ${m.qtyDelta > 0 ? '+' : ''}${m.qtyDelta}` }); setAdjusting(false); reload(); }

  return (
    <>
      <PageHeader title="Stock" sub={`${onhand.length} lines · ${totalUnits} units on hand`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setAdjusting(true)}>Stock adjustment</Button> : undefined} />

      {error && <StaleBanner message={`Showing the last stock snapshot we have. ${error}`} onRetry={reload} />}

      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <Chip label="On hand" active={tab === 'onhand'} onClick={() => setTab('onhand')} />
          <Chip label="Movements" active={tab === 'moves'} onClick={() => setTab('moves')} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {tab === 'onhand' && (
            <select value={whFilter} onChange={e => setWhFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="all">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item code..." aria-label="Search stock"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
          </div>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          {tab === 'onhand' ? (
            <table className="w-full border-collapse min-w-[620px]">
              <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['Item code', 'Description', 'Warehouse', 'On hand'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 3 ? 'text-right' : 'text-left')}>{h}</th>)}
              </tr></thead>
              <tbody>
                {loading && onhand.length === 0 ? <tr><td colSpan={4}><TableSkeleton rows={6} cols={4} /></td></tr>
                : onhand.length === 0 ? <tr><td colSpan={4}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">No stock on hand.</div></td></tr>
                : onhand.map(r => (
                  <tr key={`${r.itemCode}-${r.warehouseId}`} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.itemCode}</td>
                    <td className="py-[13px] px-4 text-[13.5px]">{r.itemName || '—'}</td>
                    <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{r.warehouseName}</td>
                    <td className={cx('py-[13px] px-4 text-right tabular-nums text-[14px] font-semibold', r.onHand < 0 ? 'text-[var(--color-critical-fg)]' : '')}>{r.onHand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse min-w-[720px]">
              <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['Date', 'Item code', 'Warehouse', 'Type', 'Ref', 'Qty', 'Note'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 5 ? 'text-right' : 'text-left')}>{h}</th>)}
              </tr></thead>
              <tbody>
                {moves.loading && movements.length === 0 ? <tr><td colSpan={7}><TableSkeleton rows={6} cols={7} /></td></tr>
                : movements.length === 0 ? <tr><td colSpan={7}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">No movements yet.</div></td></tr>
                : movements.map(m => (
                  <tr key={m.id} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{m.movedAt ? date(m.movedAt) : '—'}</td>
                    <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px]">{m.itemCode}</td>
                    <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{m.warehouseName}</td>
                    <td className="py-[13px] px-4 text-[12.5px]">{MV_LABEL[m.movementType] ?? m.movementType}</td>
                    <td className="py-[13px] px-4 text-[12px] text-muted-ink">{m.refType || '—'}</td>
                    <td className={cx('py-[13px] px-4 text-right tabular-nums text-[13px] font-semibold', m.qtyDelta < 0 ? 'text-[var(--color-critical-fg)]' : 'text-[var(--color-success-fg)]')}>{m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}</td>
                    <td className="py-[13px] px-4 text-[12.5px] text-muted-ink max-w-[200px] truncate">{m.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {adjusting && <AdjustDrawer warehouses={warehouses} canWrite={canWrite} onClose={() => setAdjusting(false)} onDone={adjusted} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}

function AdjustDrawer({ warehouses, canWrite, onClose, onDone }: { warehouses: Opt[]; canWrite: boolean; onClose: () => void; onDone: (m: Movement) => void }) {
  const [itemCode, setItemCode] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [qty, setQty] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const qtyDelta = qty ?? 0;
  const canSave = canWrite && itemCode.trim() !== '' && warehouseId !== '' && qtyDelta !== 0;

  function submit() {
    api.post('/stock', { itemCode: itemCode.trim(), warehouseId, qtyDelta, note }).catch(notifyFailure);
    const wh = warehouses.find(w => w.id === warehouseId);
    onDone({ id: `mv-new-${crypto.randomUUID().slice(0, 8)}`, itemCode: itemCode.trim(), warehouseName: wh?.name ?? '', qtyDelta, movementType: 'ADJUSTMENT', refType: 'ADJ', note, movedAt: new Date().toISOString().slice(0, 10) });
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
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an item, warehouse and a non-zero quantity" onClick={submit}>Post adjustment</Button>
      </div>
    </Drawer>
  );
}
