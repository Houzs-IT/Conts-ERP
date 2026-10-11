import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { NumberInput, DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../lib/api';
import { persist, useRecord, useResetOnReload } from '../lib/persist';
import { ShortStockPrompt } from '../components/ShortStockPrompt';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { statusLabel } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';

/** Delivery Orders — ported from 2990's SCM, drawn in Conts. Delivers a sales order's
 *  lines (fills SO delivered_qty; advances the SO to DELIVERED when complete). */

type Status = 'LOADED' | 'DISPATCHED' | 'IN_TRANSIT' | 'SIGNED' | 'DELIVERED' | 'INVOICED' | 'CANCELLED';
const FLOW: Status[] = ['LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED', 'DELIVERED'];
const FILTERS: (Status | 'all')[] = ['all', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];

interface DoLine { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; lineTotalSen: number }
interface Do { id: string; doNumber: string; soDocNo: string; salesOrderId: string; customerName: string; doDate: string; expectedDeliveryAt: string; status: Status; driverName: string; vehicle: string; address1: string; city: string; state: string; postcode: string; phone: string; notes: string; lines?: DoLine[] }
interface Payload { data: Do[]; generatedAt: string }
interface SoLine { id: string; itemCode: string; description: string; uom: string; qty: number; deliveredQty: number; unitPriceSen: number }
interface OpenSo { id: string; docNo: string; customerName: string; status: string; lines?: SoLine[] }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'do1', doNumber: 'DO-2026-0001', soDocNo: 'SO-2026-0002', salesOrderId: 'so2', customerName: 'Arcoris Owner', doDate: '2026-09-28', expectedDeliveryAt: '2026-09-29', status: 'DELIVERED', driverName: 'Rahman', vehicle: 'WXY 1234', address1: 'Arcoris #B-08-11', city: 'Mont Kiara', state: 'Kuala Lumpur', postcode: '50480', phone: '+60198887766', notes: '', lines: [{ itemCode: 'MT-KG-HIL', description: 'Hilton Mattress, King', uom: 'UNIT', qty: 1, unitPriceSen: 420000, lineTotalSen: 420000 }] },
  ],
};
const SO_FALLBACK: { data: OpenSo[] } = { data: [
  { id: 'so1', docNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', status: 'IN_PRODUCTION', lines: [
    { id: 'sol1', itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qty: 2, deliveredQty: 0, unitPriceSen: 328000 },
    { id: 'sol2', itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qty: 1, deliveredQty: 0, unitPriceSen: 189000 },
    { id: 'sol3', itemCode: 'MT-KG-HIL', description: 'Hilton Mattress, King', uom: 'UNIT', qty: 1, deliveredQty: 0, unitPriceSen: 139000 },
  ] },
] };
const WH_FALLBACK: { data: { id: string; code: string; name: string }[] } = { data: [
  { id: 'wh1', code: 'WH-MAIN', name: 'Main Warehouse' },
  { id: 'wh2', code: 'WH-KL', name: 'KL Showroom Store' },
] };

export default function DeliveryOrdersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/delivery-orders', FALLBACK);
  const openSos = (useApi<{ data: OpenSo[] }>('/sales-orders', SO_FALLBACK).data?.data ?? []).filter(s => !['CANCELLED', 'CLOSED', 'DELIVERED', 'INVOICED'].includes(s.status));
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; d: Do } | null>(null);
  const [added, setAdded] = useState<Do[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Do>>>({});
  useResetOnReload(data, () => {
    setAdded([]); setEdits({});
    setDrawer(dr => { const fresh = dr?.mode === 'view' ? data?.data.find(x => x.id === dr.d.id) : undefined; return dr?.mode === 'view' && fresh ? { mode: 'view', d: { ...dr.d, ...fresh } } : dr; });
  });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.doNumber} ${p.soDocNo} ${p.customerName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Do>[]>(() => [
    { key: 'doNumber', label: 'DO number', type: 'ref', value: p => p.doNumber, hideable: false },
    { key: 'so', label: 'SO', type: 'ref', value: p => p.soDocNo || null },
    { key: 'customer', label: 'Customer', value: p => p.customerName },
    { key: 'doDate', label: 'DO date', type: 'date', value: p => p.doDate || null },
    { key: 'driver', label: 'Driver', value: p => p.driverName, text: p => `${p.driverName || '—'}${p.vehicle ? ` · ${p.vehicle}` : ''}`, render: p => <span className="text-[12.5px] text-[var(--color-ink-2)]">{p.driverName || '—'}{p.vehicle ? ` · ${p.vehicle}` : ''}</span> },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'delivery_order' },
  ], []);

  function created(d: Do) { setAdded(a => [d, ...a]); reload(); toast({ tone: 'success', title: 'Delivery order raised.', body: `${d.doNumber} · ${d.customerName}` }); setDrawer(null); }
  function act(d: Do, patch: Record<string, unknown>, optimistic: Partial<Do>, title: string) {
    setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...optimistic } }));
    persist(api.patch(`/delivery-orders/${d.id}`, patch), { reload, ok: () => toast({ tone: 'success', title, body: d.doNumber }) });
    setDrawer(dr => dr && dr.mode === 'view' ? { mode: 'view', d: { ...dr.d, ...optimistic } } : dr);
  }

  return (
    <>
      <PageHeader title="Delivery orders" sub={data ? `${all.length} ${all.length === 1 ? 'delivery' : 'deliveries'}` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New delivery</Button> : undefined} />
      <DataTable<Do>
        id="scm.delivery-orders" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => setDrawer({ mode: 'view', d: p })}
        noun={['delivery order', 'delivery orders']} exportName="delivery-orders"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : statusLabel('delivery_order', f)} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search DO, SO or customer..." aria-label="Search delivery orders"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No delivery orders yet.', body: 'Deliver a sales order to raise a delivery order.', action: canWrite ? { label: 'New delivery', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />
      {drawer?.mode === 'new' && <DeliverDrawer openSos={openSos} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer d={drawer.d} canWrite={canWrite} onClose={() => setDrawer(null)} onAct={act} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}

/* ---------- deliver (create) drawer ---------- */

interface DelLine { soLineId: string; itemCode: string; description: string; uom: string; outstanding: number; unitPriceSen: number; qty: number | null }

function DeliverDrawer({ openSos, canWrite, onClose, onCreated }: { openSos: OpenSo[]; canWrite: boolean; onClose: () => void; onCreated: (d: Do) => void }) {
  const [soId, setSoId] = useState('');
  const [lines, setLines] = useState<DelLine[]>([]);
  const [doDate, setDoDate] = useState(new Date().toISOString().slice(0, 10));
  const [expected, setExpected] = useState('');
  const [driverName, setDriverName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [address1, setAddress1] = useState('');
  const [notes, setNotes] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const warehouses = useApi<{ data: { id: string; code: string; name: string }[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const so = openSos.find(s => s.id === soId);

  async function pick(id: string) {
    setSoId(id);
    const s = openSos.find(x => x.id === id);
    let sl = s?.lines;
    if (!sl) { try { const r = await api.get<{ data: { lines: SoLine[] } }>(`/sales-orders/${id}`); sl = r.data.lines; } catch { sl = []; } }
    setLines((sl ?? []).filter(l => l.qty - l.deliveredQty > 0).map(l => ({ soLineId: l.id, itemCode: l.itemCode, description: l.description, uom: l.uom, outstanding: l.qty - l.deliveredQty, unitPriceSen: l.unitPriceSen, qty: l.qty - l.deliveredQty })));
  }

  const willDeliver = lines.filter(l => (l.qty ?? 0) > 0);
  const canSave = canWrite && soId !== '' && willDeliver.length > 0;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const qtyError = (l: DelLine) => (l.qty ?? 0) > l.outstanding ? `Only ${l.outstanding} left to deliver.` : fieldErrors[`lines.${willDeliver.indexOf(l)}.qty`];

  const [busy, setBusy] = useState(false);
  const [shortStock, setShortStock] = useState<string | null>(null);

  // Waits for the server: a refused delivery must never show as raised.
  async function submit(confirmShortStock = false) {
    if (willDeliver.some(l => (l.qty ?? 0) > l.outstanding)) return;
    const doDateError = !doDate ? 'Enter the DO date.' : undefined;
    if (doDateError) { setFieldErrors({ doDate: doDateError }); return; }
    const payloadLines = willDeliver.map(l => ({ salesOrderLineId: l.soLineId, itemCode: l.itemCode, description: l.description, uom: l.uom, unitPriceSen: l.unitPriceSen, qty: l.qty ?? 0 }));
    setFieldErrors({});
    setBusy(true);
    try {
      const r = await api.post<{ id: string; doNumber: string }>('/delivery-orders', { salesOrderId: soId, doDate, expectedDeliveryAt: expected || null, driverName, vehicle, address1, notes, warehouseId: warehouseId || undefined, lines: payloadLines, confirmShortStock: confirmShortStock || undefined });
      onCreated({
        id: r.id, doNumber: r.doNumber, soDocNo: so?.docNo ?? '', salesOrderId: soId, customerName: so?.customerName ?? '',
        doDate, expectedDeliveryAt: expected, status: 'LOADED', driverName, vehicle, address1, city: '', state: '', postcode: '', phone: '', notes,
        lines: payloadLines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen, lineTotalSen: l.qty * l.unitPriceSen })),
      });
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'SHORT_STOCK') setShortStock(e.message);
      else { if (e instanceof ApiFailure && e.fields) setFieldErrors(e.fields); notifyFailure(e); }
    } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width={860}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New delivery order</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Sales order</label>
            <select value={soId} onChange={e => void pick(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a sales order…</option>
              {openSos.map(s => <option key={s.id} value={s.id}>{s.docNo} · {s.customerName}</option>)}
            </select>
          </div>
          <DateField label="DO date" required value={doDate} error={fieldErrors.doDate} onChange={setDoDate} />
          <DateField label="Expected delivery" value={expected} min={doDate || undefined} error={fieldErrors.expectedDeliveryAt} onChange={setExpected} />
          <Field label="Delivery address" placeholder="Optional" value={address1} onChange={e => setAddress1(e.target.value)} />
          <Field label="Driver" placeholder="Optional" value={driverName} onChange={e => setDriverName(e.target.value)} />
          <Field label="Vehicle" placeholder="Optional" value={vehicle} onChange={e => setVehicle(e.target.value)} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Dispatch from warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">No stock posting</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </div>
        </div>
        {soId && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines to deliver</div>
            <div className="overflow-x-auto border border-solid border-line rounded-card">
              <table className="w-full border-collapse min-w-[560px]">
                <thead><tr className="bg-muted">{['Item', 'Outstanding', 'Deliver qty'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>)}</tr></thead>
                <tbody>
                  {lines.length === 0 ? <tr><td colSpan={3} className="py-6 text-center text-[12.5px] text-muted-ink">This sales order has nothing left to deliver.</td></tr>
                  : lines.map((l, i) => (
                    <tr key={l.soLineId} className="[border-top:1px_solid_var(--color-line-soft)]">
                      <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.outstanding}</td>
                      <td className="py-2 px-3 text-right"><NumberInput aria-label={`Deliver quantity for ${l.itemCode}`} min={0} max={l.outstanding} value={l.qty} error={qtyError(l)} onChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: v } : x))} className="h-8 w-[80px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
        {shortStock && <ShortStockPrompt message={shortStock} actionLabel="Deliver anyway" busy={busy} onCancel={() => setShortStock(null)} onConfirm={() => void submit(true)} />}
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave || !!shortStock} disabledReason={shortStock ? 'Answer the stock question above first' : 'Pick a SO and deliver at least one line'} loading={busy && !shortStock} onClick={() => void submit()}>Raise delivery</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view drawer ---------- */

const lineColumns: Column<DoLine>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{l.itemCode}</span>, text: l => `${l.description} ${l.itemCode}` },
  { key: 'qty', label: 'Qty', type: 'number', value: l => l.qty },
  { key: 'price', label: 'Unit price', type: 'money', value: l => l.unitPriceSen },
  { key: 'total', label: 'Line total', type: 'money', value: l => l.lineTotalSen },
];

function ViewDrawer({ d, canWrite, onClose, onAct }: { d: Do; canWrite: boolean; onClose: () => void; onAct: (d: Do, patch: Record<string, unknown>, optimistic: Partial<Do>, title: string) => void }) {
  const { record, loading: linesLoading, error: linesError } = useRecord<Do>('delivery-orders', d.id);
  const lines = record?.lines ?? d.lines;
  const lineRows = useMemo(() => (lines ?? []).map((l, i) => ({ ...l, key: String(i) })), [lines]);
  const advanceLabel = (() => { const i = FLOW.indexOf(d.status); return i >= 0 && i < FLOW.length - 1 ? statusLabel('delivery_order', FLOW[i + 1]) : null; })();
  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{d.doNumber}</h2><StatusBadge entity="delivery_order" value={d.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Sales order" value={d.soDocNo || '—'} mono />
          <Meta label="Customer" value={d.customerName} />
          <Meta label="DO date" value={d.doDate ? date(d.doDate) : '—'} />
          <Meta label="Driver" value={[d.driverName, d.vehicle].filter(Boolean).join(' · ') || '—'} />
        </div>
        {(d.address1 || d.city) && <div className="text-[13px]"><span className="text-muted-ink">Deliver to: </span>{[d.address1, d.city, d.state, d.postcode].filter(Boolean).join(', ')}</div>}
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<DoLine & { key: string }>
            id="scm.delivery-order.lines" urlPrefix="lines." bare noViews noToolbar pageSize={0}
            columns={lineColumns} rows={lineRows} rowKey={l => l.key} loading={linesLoading} error={linesError}
            noun={['line', 'lines']} exportName={`${d.doNumber}-lines`}
            empty={{ title: 'No lines on this delivery.' }} />
        </div>
        {d.notes && <div className="text-[13px]"><span className="text-muted-ink">Notes: </span>{d.notes}</div>}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && d.status !== 'CANCELLED' && d.status !== 'DELIVERED' && d.status !== 'INVOICED' && <ConfirmButton confirm={{ title: `Cancel ${d.doNumber}?`, body: 'It is marked Cancelled, its items go back into stock and the sales order counts them as not delivered.', meta: d.customerName, confirmLabel: 'Cancel delivery', cancelLabel: 'Keep delivery' }} onConfirm={() => onAct(d, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Delivery cancelled.')}>Cancel</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {canWrite && advanceLabel && <Button size="sm" variant="primary" onClick={() => onAct(d, { action: 'advance' }, { status: FLOW[FLOW.indexOf(d.status) + 1] }, `Advanced to ${advanceLabel}.`)}>Advance → {advanceLabel}</Button>}
        </div>
      </div>
    </Drawer>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className={cx('text-[13.5px]', mono ? '[font-family:var(--font-mono,ui-monospace,monospace)]' : '')}>{value}</span></div>;
}
