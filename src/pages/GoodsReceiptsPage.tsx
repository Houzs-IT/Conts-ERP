import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
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
import { rm, date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/** Goods Received (GRN) — ported from 2990's SCM, drawn in Conts. Receives against a PO:
 *  each accepted qty fills the PO line's received_qty and advances the PO status. */

type Status = 'POSTED' | 'CLOSED' | 'CANCELLED';
const STATUS_LABEL: Record<Status, string> = { POSTED: 'Posted', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, Tone> = { POSTED: 'success', CLOSED: 'neutral', CANCELLED: 'critical' };
const FILTERS: (Status | 'all')[] = ['all', 'POSTED', 'CLOSED', 'CANCELLED'];

interface GrnLine { itemCode: string; description: string; uom: string; qtyReceived: number; qtyAccepted: number; qtyRejected: number; unitPriceSen: number; lineTotalSen: number }
interface Grn { id: string; grnNumber: string; poNumber: string; purchaseOrderId: string; supplierName: string; supplierCode: string; receivedAt: string; deliveryNoteRef: string; status: Status; notes: string; totalSen: number; lines?: GrnLine[] }
interface Payload { data: Grn[]; generatedAt: string }
interface PoLine { id: string; itemCode: string; description: string; uom: string; qty: number; receivedQty: number; unitPriceSen: number }
interface OpenPo { id: string; poNumber: string; supplierName: string; status: string; lines?: PoLine[] }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'grn1', grnNumber: 'GRN-2026-0001', poNumber: 'PO-2026-0002', purchaseOrderId: 'po2', supplierName: 'Hilton Bedding Manufacturing', supplierCode: 'SUP-HILTON', receivedAt: '2026-09-22', deliveryNoteRef: 'DN-8841', status: 'POSTED', notes: '', totalSen: 420000, lines: [
      { itemCode: 'MT-KG-HIL', description: 'Hilton Pocket Spring Mattress, King', uom: 'UNIT', qtyReceived: 1, qtyAccepted: 1, qtyRejected: 0, unitPriceSen: 420000, lineTotalSen: 420000 },
    ] },
    { id: 'grn2', grnNumber: 'GRN-2026-0002', poNumber: 'PO-2026-0003', purchaseOrderId: 'po3', supplierName: 'Nordic Woodcraft', supplierCode: 'SUP-NORDIC', receivedAt: '2026-09-19', deliveryNoteRef: '', status: 'POSTED', notes: '', totalSen: 378000, lines: [
      { itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qtyReceived: 2, qtyAccepted: 2, qtyRejected: 0, unitPriceSen: 189000, lineTotalSen: 378000 },
    ] },
  ],
};
const PO_FALLBACK: { data: OpenPo[] } = { data: [
  { id: 'po1', poNumber: 'PO-2026-0001', supplierName: 'Emma Furnishings Sdn Bhd', status: 'SUBMITTED', lines: [
    { id: 'pol1', itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qty: 2, receivedQty: 0, unitPriceSen: 328000 },
    { id: 'pol2', itemCode: 'SF-2S-CHR', description: 'Emma 2-Seater Sofa, Charcoal', uom: 'UNIT', qty: 1, receivedQty: 0, unitPriceSen: 328000 },
  ] },
  { id: 'po2', poNumber: 'PO-2026-0002', supplierName: 'Hilton Bedding Manufacturing', status: 'PARTIALLY_RECEIVED', lines: [
    { id: 'pol3', itemCode: 'MT-KG-HIL', description: 'Hilton Pocket Spring Mattress, King', uom: 'UNIT', qty: 2, receivedQty: 1, unitPriceSen: 420000 },
  ] },
] };
const WH_FALLBACK: { data: { id: string; code: string; name: string }[] } = { data: [
  { id: 'wh1', code: 'WH-MAIN', name: 'Main Warehouse' },
  { id: 'wh2', code: 'WH-KL', name: 'KL Showroom Store' },
] };

export default function GoodsReceiptsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/goods-receipts', FALLBACK);
  const openPos = (useApi<{ data: OpenPo[] }>('/purchase-orders?status=SUBMITTED', PO_FALLBACK).data?.data ?? [])
    .concat(useApi<{ data: OpenPo[] }>('/purchase-orders?status=PARTIALLY_RECEIVED', { data: [] }).data?.data ?? [])
    .filter(p => p.status === 'SUBMITTED' || p.status === 'PARTIALLY_RECEIVED');
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; grn: Grn } | null>(null);

  const [added, setAdded] = useState<Grn[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Grn>>>({});

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(g => ({ ...g, ...edits[g.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(g => (statusFilter === 'all' || g.status === statusFilter) && (!q || `${g.grnNumber} ${g.poNumber} ${g.supplierName}`.toLowerCase().includes(q)));

  function created(grn: Grn) {
    setAdded(a => [grn, ...a]);
    toast({ tone: 'success', title: 'Goods received.', body: `${grn.grnNumber} · ${grn.supplierName}` });
    setDrawer(null);
  }
  // Waits for the server: it refuses once the received goods have already left the warehouse.
  async function cancel(g: Grn) {
    try {
      await api.patch(`/goods-receipts/${g.id}`, { status: 'CANCELLED' });
      setEdits(e => ({ ...e, [g.id]: { ...e[g.id], status: 'CANCELLED' } }));
      toast({ tone: 'success', title: 'Goods receipt cancelled.', body: g.grnNumber });
      setDrawer(null);
    } catch (e) { notifyFailure(e); }
  }

  return (
    <>
      <PageHeader title="Goods received" sub={`${all.length} receipts · against purchase orders`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>Receive goods</Button> : undefined} />

      {error && <StaleBanner message={`Showing the last receipt list we have. ${error}`} onRetry={reload} />}

      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}
        </div>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search GRN, PO or supplier..." aria-label="Search goods receipts"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['GRN number', 'PO', 'Supplier', 'Received', 'Status', 'Total'].map((h, i) => (
                  <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 5 ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && all.length === 0 ? (
                <tr><td colSpan={6}><TableSkeleton rows={6} cols={6} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6}>
                  <div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center">
                    <span className="text-[14px] font-semibold">{q || statusFilter !== 'all' ? 'No goods receipts match.' : 'No goods received yet.'}</span>
                    <span className="text-[12.5px] text-muted-ink max-w-[380px]">Receive goods against a purchase order to record a GRN.</span>
                  </div>
                </td></tr>
              ) : rows.map(g => (
                <tr key={g.id} onClick={() => setDrawer({ mode: 'view', grn: g })} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)] cursor-pointer hover:bg-muted">
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{g.grnNumber}</span></td>
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[12.5px] text-[var(--color-ink-2)]">{g.poNumber}</td>
                  <td className="py-[13px] px-4"><div className="flex flex-col"><span className="text-[13.5px]">{g.supplierName}</span><span className="text-[11.5px] text-muted-ink">{g.supplierCode}</span></div></td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{g.receivedAt ? date(g.receivedAt) : '—'}</td>
                  <td className="py-[13px] px-4"><StatusPill status={g.status} /></td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px] font-semibold">{rm(g.totalSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {drawer?.mode === 'new' && <ReceiveDrawer openPos={openPos} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer grn={drawer.grn} canWrite={canWrite} onClose={() => setDrawer(null)} onCancel={cancel} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active}
    className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
function StatusPill({ status }: { status: Status }) {
  const t = STATUS_TONE[status];
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE[t].bg, TONE[t].text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_LABEL[status]}</span>;
}

/* ---------- receive (create) drawer ---------- */

interface RcvLine { poLineId: string; itemCode: string; description: string; uom: string; ordered: number; already: number; unitPriceSen: number; receive: string; accepted: string }

function ReceiveDrawer({ openPos, canWrite, onClose, onCreated }: { openPos: OpenPo[]; canWrite: boolean; onClose: () => void; onCreated: (g: Grn) => void }) {
  const [poId, setPoId] = useState('');
  const [lines, setLines] = useState<RcvLine[]>([]);
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [dnRef, setDnRef] = useState('');
  const [notes, setNotes] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const warehouses = useApi<{ data: { id: string; code: string; name: string }[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const po = openPos.find(p => p.id === poId);

  async function pick(id: string) {
    setPoId(id);
    const p = openPos.find(x => x.id === id);
    let poLines = p?.lines;
    if (!poLines) { try { const r = await api.get<{ data: { lines: PoLine[] } }>(`/purchase-orders/${id}`); poLines = r.data.lines; } catch { poLines = []; } }
    setLines((poLines ?? []).filter(l => l.qty - l.receivedQty > 0).map(l => {
      const outstanding = l.qty - l.receivedQty;
      return { poLineId: l.id, itemCode: l.itemCode, description: l.description, uom: l.uom, ordered: l.qty, already: l.receivedQty, unitPriceSen: l.unitPriceSen, receive: String(outstanding), accepted: String(outstanding) };
    }));
  }

  const willReceive = lines.filter(l => (Number(l.receive) || 0) > 0);
  const total = willReceive.reduce((s, l) => s + (Number(l.accepted) || 0) * l.unitPriceSen, 0);
  const canSave = canWrite && poId !== '' && willReceive.length > 0;

  function submit() {
    const payloadLines = willReceive.map(l => ({ purchaseOrderLineId: l.poLineId, itemCode: l.itemCode, description: l.description, uom: l.uom, unitPriceSen: l.unitPriceSen, qtyReceived: Number(l.receive) || 0, qtyAccepted: Math.min(Number(l.receive) || 0, Number(l.accepted) || 0) }));
    api.post('/goods-receipts', { purchaseOrderId: poId, receivedAt, deliveryNoteRef: dnRef, notes, warehouseId: warehouseId || undefined, lines: payloadLines }).catch(notifyFailure);
    onCreated({
      id: `grn-new-${crypto.randomUUID().slice(0, 8)}`, grnNumber: `GRN-${new Date().getFullYear()}-NEW`, poNumber: po?.poNumber ?? '', purchaseOrderId: poId,
      supplierName: po?.supplierName ?? '', supplierCode: '', receivedAt, deliveryNoteRef: dnRef, status: 'POSTED', notes, totalSen: total,
      lines: payloadLines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qtyReceived: l.qtyReceived, qtyAccepted: l.qtyAccepted, qtyRejected: l.qtyReceived - l.qtyAccepted, unitPriceSen: l.unitPriceSen, lineTotalSen: l.qtyAccepted * l.unitPriceSen })),
    });
  }

  return (
    <Drawer open onClose={onClose} width={860}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">Receive goods</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Purchase order</label>
            <select value={poId} onChange={e => void pick(e.target.value)}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select an open PO…</option>
              {openPos.map(p => <option key={p.id} value={p.id}>{p.poNumber} · {p.supplierName}</option>)}
            </select>
          </div>
          <Field label="Received date" type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} />
          <Field label="Delivery note ref" placeholder="Optional" value={dnRef} onChange={e => setDnRef(e.target.value)} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Receive into warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">No stock posting</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </div>
        </div>

        {poId && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines to receive</div>
            <div className="overflow-x-auto border border-solid border-line rounded-card">
              <table className="w-full border-collapse min-w-[680px]">
                <thead><tr className="bg-muted">
                  {['Item', 'Ordered', 'Received', 'Outstanding', 'Receive now', 'Accept'].map((th, i) => (
                    <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {lines.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-[12.5px] text-muted-ink">This PO has nothing outstanding to receive.</td></tr>
                  : lines.map((l, i) => (
                    <tr key={l.poLineId} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                      <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.ordered}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px] text-muted-ink">{l.already}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.ordered - l.already}</td>
                      <td className="py-2 px-3 text-right"><NumCell value={l.receive} onChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, receive: v } : x))} /></td>
                      <td className="py-2 px-3 text-right"><NumCell value={l.accepted} onChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, accepted: v } : x))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex items-end justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Received value</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div></div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a PO and receive at least one line" onClick={submit}>Post GRN</Button>
      </div>
    </Drawer>
  );
}

function NumCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="number" min={0} value={value} onChange={e => onChange(e.target.value)}
    className="h-8 w-[80px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />;
}

/* ---------- view drawer ---------- */

function ViewDrawer({ grn, canWrite, onClose, onCancel }: { grn: Grn; canWrite: boolean; onClose: () => void; onCancel: (g: Grn) => void }) {
  return (
    <Drawer open onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{grn.grnNumber}</h2><StatusPill status={grn.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Purchase order" value={grn.poNumber} mono />
          <Meta label="Supplier" value={grn.supplierName} />
          <Meta label="Received" value={grn.receivedAt ? date(grn.receivedAt) : '—'} />
          <Meta label="Delivery note" value={grn.deliveryNoteRef || '—'} />
        </div>
        <div className="overflow-x-auto border border-solid border-line rounded-card">
          <table className="w-full border-collapse min-w-[560px]">
            <thead><tr className="bg-muted">
              {['Item', 'Received', 'Accepted', 'Rejected', 'Line total'].map((th, i) => (
                <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>
              ))}
            </tr></thead>
            <tbody>
              {(grn.lines ?? []).map((l, i) => (
                <tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.qtyReceived}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.qtyAccepted}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.qtyRejected || '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.lineTotalSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {grn.notes && <div className="text-[13px]"><span className="text-muted-ink">Notes: </span>{grn.notes}</div>}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{canWrite && grn.status === 'POSTED' && <Button size="sm" variant="danger" onClick={() => onCancel(grn)}>Cancel GRN</Button>}</div>
        <div className="flex gap-2.5 items-center"><span className="text-[13px] text-muted-ink">Total</span><span className="text-[15px] font-semibold tabular-nums">{rm(grn.totalSen)}</span>
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Drawer>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className={cx('text-[13.5px]', mono ? '[font-family:var(--font-mono,ui-monospace,monospace)]' : '')}>{value}</span></div>;
}
