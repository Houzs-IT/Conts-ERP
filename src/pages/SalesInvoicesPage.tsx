import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';
import { statusLabel } from '../lib/status';

/** Sales Invoices (AR) — ported from 2990's SCM, drawn in Conts. Bills a delivery order;
 *  receipts drive the paid status. Money integer sen. */

type Status = 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
const FILTERS: (Status | 'all')[] = ['all', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];

interface SiLine { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; lineTotalSen: number }
interface Si { id: string; invoiceNumber: string; doNumber: string; soDocNo: string; customerName: string; invoiceDate: string; dueDate: string; status: Status; totalSen: number; paidSen: number; outstandingSen: number; notes: string; lines?: SiLine[] }
interface Payload { data: Si[]; generatedAt: string }
interface DoLine { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; lineTotalSen: number }
interface OpenDo { id: string; doNumber: string; customerName: string; status: string; lines?: DoLine[] }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'si1', invoiceNumber: 'SINV-2026-0001', doNumber: 'DO-2026-0001', soDocNo: 'SO-2026-0002', customerName: 'Arcoris Owner', invoiceDate: '2026-09-29', dueDate: '2026-10-29', status: 'PAID', totalSen: 420000, paidSen: 420000, outstandingSen: 0, notes: '', lines: [{ itemCode: 'MT-KG-HIL', description: 'Hilton Mattress, King', uom: 'UNIT', qty: 1, unitPriceSen: 420000, lineTotalSen: 420000 }] },
  ],
};
const DO_FALLBACK: { data: OpenDo[] } = { data: [
  { id: 'do2', doNumber: 'DO-2026-0002', customerName: 'Vista Jaya Residences', status: 'DELIVERED', lines: [
    { itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qty: 2, unitPriceSen: 328000, lineTotalSen: 656000 },
  ] },
] };

export default function SalesInvoicesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/sales-invoices', FALLBACK);
  const openDos = (useApi<{ data: OpenDo[] }>('/delivery-orders', DO_FALLBACK).data?.data ?? []).filter(d => !['CANCELLED', 'INVOICED'].includes(d.status));
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; si: Si } | null>(null);
  const [added, setAdded] = useState<Si[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Si>>>({});

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.invoiceNumber} ${p.customerName}`.toLowerCase().includes(q)));
  const outstanding = all.filter(p => p.status !== 'CANCELLED').reduce((s, p) => s + p.outstandingSen, 0);

  const columns = useMemo<Column<Si>[]>(() => [
    { key: 'invoiceNumber', label: 'Invoice', type: 'ref', value: p => p.invoiceNumber, hideable: false },
    { key: 'customer', label: 'Customer', value: p => p.customerName },
    { key: 'do', label: 'DO', type: 'ref', value: p => p.doNumber || null },
    { key: 'invoiceDate', label: 'Invoice date', type: 'date', value: p => p.invoiceDate || null },
    { key: 'due', label: 'Due', type: 'date', value: p => p.dueDate || null },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'sales_invoice' },
    { key: 'total', label: 'Total', type: 'money', value: p => p.totalSen },
    { key: 'outstanding', label: 'Outstanding', type: 'money', value: p => p.status === 'CANCELLED' ? null : p.outstandingSen, render: p => p.status === 'CANCELLED' ? <span className="text-muted-ink">—</span> : <span className="tabular-nums font-semibold">{rm(p.outstandingSen)}</span> },
  ], []);

  function created(si: Si) { setAdded(a => [si, ...a]); toast({ tone: 'success', title: 'Invoice raised.', body: `${si.invoiceNumber} · ${si.customerName}` }); setDrawer(null); }
  function act(si: Si, patch: Record<string, unknown>, optimistic: Partial<Si>, title: string) {
    setEdits(e => ({ ...e, [si.id]: { ...e[si.id], ...optimistic } }));
    api.patch(`/sales-invoices/${si.id}`, patch).catch(notifyFailure);
    toast({ tone: 'success', title, body: si.invoiceNumber });
    setDrawer(d => d && d.mode === 'view' ? { mode: 'view', si: { ...d.si, ...optimistic } } : d);
  }

  return (
    <>
      <PageHeader title="Sales invoices" sub={`${all.length} invoices · ${rm(outstanding, { cents: false })} outstanding`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New invoice</Button> : undefined} />
      <DataTable<Si>
        id="scm.sales-invoices" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => setDrawer({ mode: 'view', si: p })}
        noun={['sales invoice', 'sales invoices']} exportName="sales-invoices"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : statusLabel('sales_invoice', f)} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice or customer..." aria-label="Search sales invoices"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No sales invoices yet.', body: 'Invoice a delivery order to bill the customer.', action: canWrite ? { label: 'New invoice', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />
      {drawer?.mode === 'new' && <BillDrawer openDos={openDos} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer si={drawer.si} canWrite={canWrite} onClose={() => setDrawer(null)} onAct={act} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}

const lineColumns: Column<SiLine>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{l.itemCode}</span>, text: l => `${l.description} ${l.itemCode}` },
  { key: 'qty', label: 'Qty', type: 'number', value: l => l.qty },
  { key: 'price', label: 'Unit price', type: 'money', value: l => l.unitPriceSen },
  { key: 'total', label: 'Line total', type: 'money', value: l => l.lineTotalSen },
];

function BillDrawer({ openDos, canWrite, onClose, onCreated }: { openDos: OpenDo[]; canWrite: boolean; onClose: () => void; onCreated: (s: Si) => void }) {
  const [doId, setDoId] = useState('');
  const [lines, setLines] = useState<DoLine[]>([]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [tax, setTax] = useState('');
  const [notes, setNotes] = useState('');
  const dord = openDos.find(d => d.id === doId);

  async function pick(id: string) {
    setDoId(id);
    const d = openDos.find(x => x.id === id);
    let dl = d?.lines;
    if (!dl) { try { const r = await api.get<{ data: { lines: DoLine[] } }>(`/delivery-orders/${id}`); dl = r.data.lines; } catch { dl = []; } }
    setLines(dl ?? []);
  }
  const lineRows = useMemo(() => lines.map((l, i) => ({ ...l, key: String(i) })), [lines]);
  const subtotal = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  const taxSen = Math.max(0, Math.round((Number(tax) || 0) * 100));
  const total = subtotal + taxSen;
  const canSave = canWrite && doId !== '' && lines.length > 0;

  function submit() {
    api.post('/sales-invoices', { deliveryOrderId: doId, invoiceDate, dueDate: dueDate || null, taxSen, notes }).catch(notifyFailure);
    onCreated({ id: `si-new-${crypto.randomUUID().slice(0, 8)}`, invoiceNumber: `SINV-${new Date().getFullYear()}-NEW`, doNumber: dord?.doNumber ?? '', soDocNo: '', customerName: dord?.customerName ?? '', invoiceDate, dueDate, status: 'SENT', totalSen: total, paidSen: 0, outstandingSen: total, notes, lines });
  }

  return (
    <Drawer open onClose={onClose} width={780}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New sales invoice</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Delivery order</label>
            <select value={doId} onChange={e => void pick(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a delivery order…</option>
              {openDos.map(d => <option key={d.id} value={d.id}>{d.doNumber} · {d.customerName}</option>)}
            </select>
          </div>
          <Field label="Invoice date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
          <Field label="Due date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        {doId && (
          <div className="border border-solid border-line rounded-card overflow-hidden">
            <DataTable<DoLine & { key: string }>
              id="scm.sales-invoice.new-lines" urlPrefix="newlines." bare noViews noToolbar pageSize={0}
              columns={lineColumns} rows={lineRows} rowKey={l => l.key}
              noun={['line', 'lines']} exportName="invoice-lines"
              empty={{ title: 'This delivery order has no lines.' }} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex flex-col gap-1.5 items-end justify-end">
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Subtotal</span><span className="tabular-nums w-[120px] text-right">{rm(subtotal)}</span></div>
            <div className="flex gap-8 text-[13px] items-center"><span className="text-muted-ink">Tax</span><input type="number" step="0.01" value={tax} placeholder="0.00" onChange={e => setTax(e.target.value)} className="h-8 w-[120px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></div>
            <div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div>
          </div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a delivery order" onClick={submit}>Raise invoice</Button>
      </div>
    </Drawer>
  );
}

function ViewDrawer({ si, canWrite, onClose, onAct }: { si: Si; canWrite: boolean; onClose: () => void; onAct: (s: Si, patch: Record<string, unknown>, optimistic: Partial<Si>, title: string) => void }) {
  const [recv, setRecv] = useState('');
  const recvSen = Math.max(0, Math.round((Number(recv) || 0) * 100));
  const lineRows = useMemo(() => (si.lines ?? []).map((l, i) => ({ ...l, key: String(i) })), [si.lines]);
  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{si.invoiceNumber}</h2><StatusBadge entity="sales_invoice" value={si.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Customer" value={si.customerName} />
          <Meta label="Delivery order" value={si.doNumber || '—'} mono />
          <Meta label="Invoice date" value={si.invoiceDate ? date(si.invoiceDate) : '—'} />
          <Meta label="Due" value={si.dueDate ? date(si.dueDate) : '—'} />
        </div>
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<SiLine & { key: string }>
            id="scm.sales-invoice.lines" urlPrefix="lines." bare noViews noToolbar pageSize={0}
            columns={lineColumns} rows={lineRows} rowKey={l => l.key}
            noun={['line', 'lines']} exportName={`${si.invoiceNumber}-lines`}
            empty={{ title: 'No lines on this invoice.' }} />
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Total</span><span className="tabular-nums w-[120px] text-right">{rm(si.totalSen)}</span></div>
          <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Received</span><span className="tabular-nums w-[120px] text-right">{rm(si.paidSen)}</span></div>
          <div className="flex gap-8 text-[15px] font-semibold"><span>Outstanding</span><span className="tabular-nums w-[120px] text-right">{rm(si.outstandingSen)}</span></div>
        </div>
        {canWrite && si.status !== 'CANCELLED' && si.outstandingSen > 0 && (
          <div className="flex items-center gap-2.5 justify-end">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Record receipt</span>
            <input type="number" step="0.01" value={recv} placeholder="0.00" onChange={e => setRecv(e.target.value)} className="h-9 w-[130px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />
            <Button size="sm" variant="secondary" disabled={recvSen <= 0} disabledReason="Enter an amount" onClick={() => { const amt = Math.min(recvSen, si.outstandingSen); onAct(si, { receiveSen: amt }, { paidSen: si.paidSen + amt, outstandingSen: si.outstandingSen - amt }, 'Receipt recorded.'); setRecv(''); }}>Record</Button>
          </div>
        )}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && si.status !== 'CANCELLED' && si.paidSen === 0 && <ConfirmButton confirm={{ title: `Cancel ${si.invoiceNumber}?`, body: 'It is marked Cancelled and its delivery order can be billed again.', meta: `${si.customerName} · ${rm(si.totalSen)}`, confirmLabel: 'Cancel invoice', cancelLabel: 'Keep invoice' }} onConfirm={() => onAct(si, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Invoice cancelled.')}>Cancel invoice</ConfirmButton>}</div>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Drawer>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className={cx('text-[13.5px]', mono ? '[font-family:var(--font-mono,ui-monospace,monospace)]' : '')}>{value}</span></div>;
}
