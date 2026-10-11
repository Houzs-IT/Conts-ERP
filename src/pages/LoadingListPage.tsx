import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Drawer } from '../components/Dialog';
import { DateField } from '../components/inputs';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';

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

const driverText = (r: Row) => r.driverName || r.vehicle ? `${r.driverName || '—'}${r.vehicle ? ` · ${r.vehicle}` : ''}` : 'Unassigned';

export default function LoadingListPage() {
  const { data, loading, error, reload } = useApi<Payload>('/loading-list', FALLBACK);
  const warehouses = useApi<{ data: Wh[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const [whFilter, setWhFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [drawer, setDrawer] = useState<Row | null>(null);

  const all = data?.data ?? [];
  const rows = useMemo(() => all.filter(r => (whFilter === 'all' || r.warehouseId === whFilter) && (!dateFilter || r.doDate === dateFilter)), [all, whFilter, dateFilter]);
  const shownUnits = rows.reduce((s, r) => s + r.totalQty, 0);

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'do', label: 'Delivery order', type: 'ref', value: r => r.doNumber, hideable: false },
    { key: 'customer', label: 'Customer', value: r => r.customerName },
    { key: 'warehouse', label: 'Warehouse', value: r => r.warehouseName || r.warehouseCode || null },
    { key: 'date', label: 'Date', type: 'date', value: r => r.doDate || null },
    { key: 'driver', label: 'Driver / vehicle', value: driverText, render: r => <span className="text-[12.5px] text-muted-ink">{driverText(r)}</span> },
    { key: 'lines', label: 'Lines', type: 'number', value: r => r.lineCount },
    { key: 'units', label: 'Units', type: 'number', value: r => r.totalQty, render: r => <span className="tabular-nums font-semibold">{r.totalQty}</span> },
  ], []);

  return (
    <>
      <PageHeader title="Loading list" sub={data ? `${all.length} ${all.length === 1 ? 'delivery order' : 'delivery orders'} ready to load` : '\u00a0'} />
      <DataTable<Row>
        id="scm.loading-list" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={r => setDrawer(r)}
        noun={['delivery order', 'delivery orders']} exportName="loading-list"
        toolbar={<div className="flex items-center gap-2.5 flex-wrap">
          <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="all">All warehouses</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
          <label className="text-[12px] font-medium text-muted-ink ml-2">Date</label>
          <DateField aria-label="Date" value={dateFilter} onChange={setDateFilter} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" />
        </div>}
        above={<div className="flex items-baseline justify-end gap-2.5 px-4 py-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Units to load</span>
          <span className="text-[22px] font-semibold tabular-nums">{shownUnits}</span>
        </div>}
        filtered={whFilter !== 'all' || !!dateFilter} onClearFilters={() => { setWhFilter('all'); setDateFilter(''); }}
        empty={{ title: 'Nothing to load.', body: 'Delivery orders show here once they are packed (status Loaded) and waiting to dispatch.' }} />
      {drawer && <ItemsDrawer row={drawer} onClose={() => setDrawer(null)} />}
    </>
  );
}

const lineColumns: Column<DoLine & { i: number }>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px]">{l.itemCode}</span>, hideable: false },
  { key: 'qty', label: 'Qty', type: 'number', value: l => l.qty, render: l => <span className="tabular-nums font-semibold">{l.qty} {l.uom}</span> },
];

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
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<DoLine & { i: number }> id="scm.loading-list.items" urlPrefix="items." bare noViews noToolbar pageSize={0}
            columns={lineColumns} rows={lines ? lines.map((l, i) => ({ ...l, i })) : null} rowKey={l => String(l.i)} loading={lines === null}
            noun={['item', 'items']} exportName={`${row.doNumber}-items`} empty={{ title: 'No line items.' }} />
        </div>
      </div>
    </Drawer>
  );
}
