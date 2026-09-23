import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

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
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [whFilter, setWhFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [added, setAdded] = useState<Mv[]>([]);

  const all = useMemo(() => [...added, ...(data?.data ?? [])], [added, data]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(m => (whFilter === 'all' || m.warehouseId === whFilter) && (!q || `${m.itemCode} ${m.note}`.toLowerCase().includes(q)));

  function create(m: Mv) { setAdded(a => [m, ...a]); api.post('/stock', { itemCode: m.itemCode, warehouseId: m.warehouseId, qtyDelta: m.qtyDelta, note: m.note }).catch(notifyFailure); toast({ tone: 'success', title: 'Adjustment posted.', body: `${m.itemCode} ${m.qtyDelta > 0 ? '+' : ''}${m.qtyDelta}` }); setDrawer(false); }

  return (
    <>
      <PageHeader title="Adjustments" sub={`${all.length} stock adjustments`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(true)}>New adjustment</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last adjustments we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="all">All warehouses</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item / reason..." aria-label="Search adjustments"
          className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[640px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Date', 'Item', 'Warehouse', 'Change', 'Reason'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 3 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={5}><TableSkeleton rows={6} cols={5} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">{q || whFilter !== 'all' ? 'No adjustments match.' : 'No adjustments yet.'}</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Post a manual correction to on-hand stock — it lands in the movement ledger.</span></div></td></tr>
              : rows.map(m => (
                <tr key={m.id} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)] tabular-nums">{m.movedAt ? date(m.movedAt) : '—'}</td>
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px]">{m.itemCode}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{m.warehouseName || m.warehouseCode || '—'}</td>
                  <td className="py-[13px] px-4 text-right"><span className={cx('tabular-nums text-[13px] font-semibold', m.qtyDelta > 0 ? TONE.success.text : TONE.critical.text)}>{m.qtyDelta > 0 ? '+' : ''}{m.qtyDelta}</span></td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink max-w-[240px] truncate">{m.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <AdjustDrawer warehouses={warehouses} canWrite={canWrite} onClose={() => setDrawer(false)} onCreate={create} />}
    </>
  );
}

function AdjustDrawer({ warehouses, canWrite, onClose, onCreate }: { warehouses: Wh[]; canWrite: boolean; onClose: () => void; onCreate: (m: Mv) => void }) {
  const [itemCode, setItemCode] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const magnitude = Math.abs(Math.round(Number(qty) || 0));
  const canSave = canWrite && itemCode.trim() !== '' && warehouseId !== '' && magnitude > 0;

  function submit() {
    const wh = warehouses.find(w => w.id === warehouseId);
    const delta = direction === 'in' ? magnitude : -magnitude;
    const fullNote = note.trim() ? `${reason} — ${note.trim()}` : reason;
    onCreate({ id: `adj-new-${crypto.randomUUID().slice(0, 8)}`, itemCode: itemCode.trim(), warehouseId, warehouseCode: wh?.code ?? '', warehouseName: wh?.name ?? '', qtyDelta: delta, note: fullNote, movedAt: new Date().toISOString().slice(0, 10) });
  }

  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">New stock adjustment</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <Field label="Item code" placeholder="e.g. SF-3S-GRY" value={itemCode} onChange={e => setItemCode(e.target.value)} />
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Direction</label>
            <select value={direction} onChange={e => setDirection(e.target.value as 'in' | 'out')} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="in">Increase (+)</option><option value="out">Decrease (−)</option>
            </select>
          </div>
          <Field label="Quantity" type="number" numeric min={1} value={qty} onChange={e => setQty(e.target.value)} />
        </div>
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <Field label="Note" placeholder="Optional detail" value={note} onChange={e => setNote(e.target.value)} />
        <div className="text-[12.5px] text-muted-ink">Posts <span className={cx('font-semibold', direction === 'in' ? TONE.success.text : TONE.critical.text)}>{direction === 'in' ? '+' : '−'}{magnitude}</span> to the stock ledger for <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{itemCode || '—'}</span>.</div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an item, warehouse and quantity" onClick={submit}>Post adjustment</Button>
      </div>
    </Drawer>
  );
}
