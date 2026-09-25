import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, ApiFailure } from '../lib/api';
import { ShortStockPrompt } from '../components/ShortStockPrompt';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/** Delivery Orders — ported from 2990's SCM, drawn in Conts. Delivers a sales order's
 *  lines (fills SO delivered_qty; advances the SO to DELIVERED when complete). */

type Status = 'LOADED' | 'DISPATCHED' | 'IN_TRANSIT' | 'SIGNED' | 'DELIVERED' | 'INVOICED' | 'CANCELLED';
const STATUS_LABEL: Record<Status, string> = { LOADED: 'Loaded', DISPATCHED: 'Dispatched', IN_TRANSIT: 'In transit', SIGNED: 'Signed', DELIVERED: 'Delivered', INVOICED: 'Invoiced', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, Tone> = { LOADED: 'info', DISPATCHED: 'info', IN_TRANSIT: 'warning', SIGNED: 'info', DELIVERED: 'success', INVOICED: 'success', CANCELLED: 'critical' };
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

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.doNumber} ${p.soDocNo} ${p.customerName}`.toLowerCase().includes(q)));

  function created(d: Do) { setAdded(a => [d, ...a]); toast({ tone: 'success', title: 'Delivery order raised.', body: `${d.doNumber} · ${d.customerName}` }); setDrawer(null); }
  function act(d: Do, patch: Record<string, unknown>, optimistic: Partial<Do>, title: string) {
    setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...optimistic } }));
    api.patch(`/delivery-orders/${d.id}`, patch).catch(notifyFailure);
    toast({ tone: 'success', title, body: d.doNumber });
    setDrawer(dr => dr && dr.mode === 'view' ? { mode: 'view', d: { ...dr.d, ...optimistic } } : dr);
  }

  return (
    <>
      <PageHeader title="Delivery orders" sub={`${all.length} deliveries`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New delivery</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last delivery list we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search DO, SO or customer..." aria-label="Search delivery orders"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['DO number', 'SO', 'Customer', 'DO date', 'Driver', 'Status'].map(h => (
                <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={6} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">{q || statusFilter !== 'all' ? 'No delivery orders match.' : 'No delivery orders yet.'}</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Deliver a sales order to raise a delivery order.</span></div></td></tr>
              : rows.map(p => (
                <tr key={p.id} onClick={() => setDrawer({ mode: 'view', d: p })} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)] cursor-pointer hover:bg-muted">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{p.doNumber}</td>
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[12px] text-muted-ink">{p.soDocNo || '—'}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{p.customerName}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{p.doDate ? date(p.doDate) : '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-[var(--color-ink-2)]">{p.driverName || '—'}{p.vehicle ? ` · ${p.vehicle}` : ''}</td>
                  <td className="py-[13px] px-4"><StatusPill status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer?.mode === 'new' && <DeliverDrawer openSos={openSos} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer d={drawer.d} canWrite={canWrite} onClose={() => setDrawer(null)} onAct={act} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
function StatusPill({ status }: { status: Status }) {
  const t = STATUS_TONE[status];
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE[t].bg, TONE[t].text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_LABEL[status]}</span>;
}

/* ---------- deliver (create) drawer ---------- */

interface DelLine { soLineId: string; itemCode: string; description: string; uom: string; outstanding: number; unitPriceSen: number; qty: string }

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
    setLines((sl ?? []).filter(l => l.qty - l.deliveredQty > 0).map(l => ({ soLineId: l.id, itemCode: l.itemCode, description: l.description, uom: l.uom, outstanding: l.qty - l.deliveredQty, unitPriceSen: l.unitPriceSen, qty: String(l.qty - l.deliveredQty) })));
  }

  const willDeliver = lines.filter(l => (Number(l.qty) || 0) > 0);
  const canSave = canWrite && soId !== '' && willDeliver.length > 0;

  const [busy, setBusy] = useState(false);
  const [shortStock, setShortStock] = useState<string | null>(null);

  // Waits for the server: a refused delivery must never show as raised.
  async function submit(confirmShortStock = false) {
    const payloadLines = willDeliver.map(l => ({ salesOrderLineId: l.soLineId, itemCode: l.itemCode, description: l.description, uom: l.uom, unitPriceSen: l.unitPriceSen, qty: Math.min(Number(l.qty) || 0, l.outstanding) }));
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
      else notifyFailure(e);
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
          <Field label="DO date" type="date" value={doDate} onChange={e => setDoDate(e.target.value)} />
          <Field label="Expected delivery" type="date" value={expected} onChange={e => setExpected(e.target.value)} />
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
                    <tr key={l.soLineId} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                      <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.outstanding}</td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={l.qty} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} className="h-8 w-[80px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
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
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave || !!shortStock} disabledReason={shortStock ? 'Answer the stock question above first' : 'Pick a SO and deliver at least one line'} loading={busy && !shortStock} onClick={() => void submit()}>Raise delivery</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view drawer ---------- */

function ViewDrawer({ d, canWrite, onClose, onAct }: { d: Do; canWrite: boolean; onClose: () => void; onAct: (d: Do, patch: Record<string, unknown>, optimistic: Partial<Do>, title: string) => void }) {
  const advanceLabel = (() => { const i = FLOW.indexOf(d.status); return i >= 0 && i < FLOW.length - 1 ? STATUS_LABEL[FLOW[i + 1]] : null; })();
  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{d.doNumber}</h2><StatusPill status={d.status} /></div>
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
        <div className="overflow-x-auto border border-solid border-line rounded-card">
          <table className="w-full border-collapse min-w-[460px]">
            <thead><tr className="bg-muted">{['Item', 'Qty', 'Unit price', 'Line total'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>)}</tr></thead>
            <tbody>
              {(d.lines ?? []).map((l, i) => (
                <tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.qty}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.unitPriceSen)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.lineTotalSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.notes && <div className="text-[13px]"><span className="text-muted-ink">Notes: </span>{d.notes}</div>}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{canWrite && d.status !== 'CANCELLED' && d.status !== 'DELIVERED' && d.status !== 'INVOICED' && <Button size="sm" variant="danger" onClick={() => onAct(d, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Delivery cancelled.')}>Cancel</Button>}</div>
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
