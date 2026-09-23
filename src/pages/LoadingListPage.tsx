import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { cx } from '../lib/design-tokens';

/** Loading List — the warehouse loading manifest: delivery orders that are LOADED (packed,
 *  ready to dispatch), with what and how much to load. Read-only view over delivery orders,
 *  drawn in Conts. */

interface Row { id: string; doNumber: string; customerName: string; doDate: string; warehouseId: string; warehouseCode: string; warehouseName: string; driverName: string; vehicle: string; lineCount: number; totalQty: number }
interface Payload { data: Row[]; totalQty: number; generatedAt: string }
interface Wh { id: string; code: string; name: string }
interface DoLine { itemCode: string; description: string; uom: string; qty: number }

const WH_FALLBACK: { data: Wh[] } = { data: [
  { id: 'wh1', code: 'WH-MAIN', name: 'Main Warehouse' }, { id: 'wh2', code: 'WH-KL', name: 'KL Showroom Store' },
] };
const FALLBACK: Payload = { generatedAt: '', totalQty: 5, data: [
  { id: 'do1', doNumber: 'DO-2026-0005', customerName: 'Vista Jaya Residences', doDate: '2026-09-24', warehouseId: 'wh1', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse', driverName: 'Ahmad Zaki', vehicle: 'LRY-01', lineCount: 2, totalQty: 3 },
  { id: 'do2', doNumber: 'DO-2026-0006', customerName: 'Arcoris Owner', doDate: '2026-09-24', warehouseId: 'wh1', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse', driverName: '', vehicle: '', lineCount: 1, totalQty: 2 },
] };

export default function LoadingListPage() {
  const { data, loading, error, reload } = useApi<Payload>('/loading-list', FALLBACK);
  const warehouses = useApi<{ data: Wh[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const [whFilter, setWhFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [drawer, setDrawer] = useState<Row | null>(null);

  const all = data?.data ?? [];
  const rows = useMemo(() => all.filter(r => (whFilter === 'all' || r.warehouseId === whFilter) && (!dateFilter || r.doDate === dateFilter)), [all, whFilter, dateFilter]);
  const shownUnits = rows.reduce((s, r) => s + r.totalQty, 0);

  return (
    <>
      <PageHeader title="Loading list" sub={`${all.length} delivery orders ready to load`} />
      {error && <StaleBanner message={`Showing the last loading list we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="all">All warehouses</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
          <label className="text-[12px] font-medium text-muted-ink ml-2">Date</label>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" />
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Units to load</span>
          <span className="text-[22px] font-semibold tabular-nums">{shownUnits}</span>
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Delivery order', 'Customer', 'Warehouse', 'Date', 'Driver / vehicle', 'Lines', 'Units'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i >= 5 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={7}><TableSkeleton rows={5} cols={7} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={7}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">Nothing to load.</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Delivery orders show here once they are packed (status Loaded) and waiting to dispatch.</span></div></td></tr>
              : rows.map(r => (
                <tr key={r.id} onClick={() => setDrawer(r)} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)] cursor-pointer hover:bg-muted">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.doNumber}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{r.customerName}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{r.warehouseName || r.warehouseCode || '—'}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)] tabular-nums">{r.doDate ? date(r.doDate) : '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{r.driverName || r.vehicle ? `${r.driverName || '—'}${r.vehicle ? ` · ${r.vehicle}` : ''}` : 'Unassigned'}</td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px] text-muted-ink">{r.lineCount}</td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px] font-semibold">{r.totalQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <ItemsDrawer row={drawer} onClose={() => setDrawer(null)} />}
    </>
  );
}

function ItemsDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const [lines, setLines] = useState<DoLine[] | null>(null);
  useEffect(() => { let live = true; (async () => { try { const r = await api.get<{ data: { lines: DoLine[] } }>(`/delivery-orders/${row.id}`); if (live) setLines(r.data.lines); } catch { if (live) setLines([]); } })(); return () => { live = false; }; }, [row.id]);
  return (
    <Drawer open onClose={onClose} width={620}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex flex-col"><h2 className="m-0 text-[19px] font-semibold">{row.doNumber}</h2><span className="text-[12.5px] text-muted-ink">{row.customerName} · {row.warehouseName}</span></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Items to load</div>
        <div className="overflow-x-auto border border-solid border-line rounded-card">
          <table className="w-full border-collapse min-w-[380px]">
            <thead><tr className="bg-muted">{['Item', 'Qty'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>)}</tr></thead>
            <tbody>
              {lines === null ? <tr><td colSpan={2} className="py-6 text-center text-[12.5px] text-muted-ink">Loading…</td></tr>
              : lines.length === 0 ? <tr><td colSpan={2} className="py-6 text-center text-[12.5px] text-muted-ink">No line items.</td></tr>
              : lines.map((l, i) => (
                <tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px] font-semibold">{l.qty} {l.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>
  );
}
