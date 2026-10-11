import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useRecord, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date, todayMyt } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';
import { statusLabel } from '../lib/status';
import { CloseButton } from '../components/CloseButton';

/** Sales Invoices (AR) — ported from 2990's SCM, drawn in Conts. Bills a delivery order;
 *  receipts drive the paid status. Money integer sen. */

type Status = 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
const FILTERS: (Status | 'all')[] = ['all', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];

interface SiLine { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; discountSen?: number; lineTotalSen: number }
interface Si { id: string; invoiceNumber: string; doNumber: string; soDocNo: string; customerName: string; invoiceDate: string; dueDate: string; status: Status; subtotalSen?: number; taxSen?: number; totalSen: number; paidSen: number; outstandingSen: number; notes: string; lines?: SiLine[] }
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
  useResetOnReload(data, () => {
    setAdded([]); setEdits({});
    setDrawer(d => { const fresh = d?.mode === 'view' ? data?.data.find(x => x.id === d.si.id) : undefined; return d?.mode === 'view' && fresh ? { mode: 'view', si: { ...d.si, ...fresh } } : d; });
  });

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

  function created(si: Si, req: Promise<unknown>) { setAdded(a => [si, ...a]); setDrawer(null); persist(req, { reload, ok: () => toast({ tone: 'success', title: 'Invoice raised.', body: si.customerName }) }); }
  function act(si: Si, patch: Record<string, unknown>, optimistic: Partial<Si>, title: string) {
    setEdits(e => ({ ...e, [si.id]: { ...e[si.id], ...optimistic } }));
    persist(api.patch(`/sales-invoices/${si.id}`, patch), { reload, ok: () => toast({ tone: 'success', title, body: si.invoiceNumber }) });
    setDrawer(d => d && d.mode === 'view' ? { mode: 'view', si: { ...d.si, ...optimistic } } : d);
  }

  return (
    <>
      <PageHeader title="Sales invoices" sub={data ? `${all.length} ${all.length === 1 ? 'invoice' : 'invoices'} · ${rm(outstanding, { cents: false })} outstanding` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New invoice</Button> : undefined} />
      <DataTable<Si>
        id="scm.sales-invoices" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => setDrawer({ mode: 'view', si: p })}
        noun={['sales invoice', 'sales invoices']} exportName="sales-invoices"
        toolbar={<>
          <Segmented label="Status" options={FILTERS.map(f => ({ key: f, label: f === 'all' ? 'All' : statusLabel('sales_invoice', f) }))} value={statusFilter} onChange={setStatusFilter} />
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

const lineColumns: Column<SiLine>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{l.itemCode}</span>, text: l => `${l.description} ${l.itemCode}` },
  { key: 'qty', label: 'Qty', type: 'number', value: l => l.qty },
  { key: 'price', label: 'Unit price', type: 'money', value: l => l.unitPriceSen },
  { key: 'discount', label: 'Discount', type: 'money', value: l => l.discountSen ?? 0 },
  { key: 'total', label: 'Line total', type: 'money', value: l => l.lineTotalSen },
];

function BillDrawer({ openDos, canWrite, onClose, onCreated }: { openDos: OpenDo[]; canWrite: boolean; onClose: () => void; onCreated: (s: Si, req: Promise<unknown>) => void }) {
  const [doId, setDoId] = useState('');
  const [lines, setLines] = useState<DoLine[]>([]);
  const [invoiceDate, setInvoiceDate] = useState(todayMyt());
  const [dueDate, setDueDate] = useState('');
  const [taxSen, setTaxSen] = useState<number | null>(null);
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
  const total = subtotal + (taxSen ?? 0);
  const dueError = dueDate && invoiceDate && dueDate < invoiceDate ? 'Due date cannot be before the invoice date.' : undefined;
  const canSave = canWrite && doId !== '' && lines.length > 0 && invoiceDate !== '' && !dueError;

  function submit() {
    const req = api.post('/sales-invoices', { deliveryOrderId: doId, invoiceDate, dueDate: dueDate || null, taxSen: taxSen ?? 0, notes });
    onCreated({ id: `si-new-${crypto.randomUUID().slice(0, 8)}`, invoiceNumber: 'Saving…', doNumber: dord?.doNumber ?? '', soDocNo: '', customerName: dord?.customerName ?? '', invoiceDate, dueDate, status: 'SENT', totalSen: total, paidSen: 0, outstandingSen: total, notes, lines }, req);
  }

  return (
    <Drawer open onClose={onClose} width={780}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New sales invoice</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Delivery order</label>
            <select value={doId} onChange={e => void pick(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a delivery order…</option>
              {openDos.map(d => <option key={d.id} value={d.id}>{d.doNumber} · {d.customerName}</option>)}
            </select>
          </div>
          <DateField label="Invoice date" required value={invoiceDate} onChange={setInvoiceDate} />
          <DateField label="Due date" value={dueDate} min={invoiceDate || undefined} error={dueError} onChange={setDueDate} />
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex flex-col gap-1.5 items-end justify-end">
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Subtotal</span><span className="tabular-nums w-[120px] text-right">{rm(subtotal)}</span></div>
            <div className="flex gap-8 text-[13px] items-center"><span className="text-muted-ink">Tax</span><MoneyInput aria-label="Tax (RM)" valueSen={taxSen} onChangeSen={setTaxSen} className="h-8 w-[120px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></div>
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
  const { record, loading: linesLoading, error: linesError } = useRecord<Si>('sales-invoices', si.id);
  const [recvSen, setRecvSen] = useState<number | null>(null);
  const lineRows = useMemo(() => (record?.lines ?? si.lines ?? []).map((l, i) => ({ ...l, key: String(i) })), [record, si.lines]);
  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{si.invoiceNumber}</h2><StatusBadge entity="sales_invoice" value={si.status} /></div>
        <CloseButton onClick={onClose} />
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
            columns={lineColumns} rows={lineRows} rowKey={l => l.key} loading={linesLoading} error={linesError}
            noun={['line', 'lines']} exportName={`${si.invoiceNumber}-lines`}
            empty={{ title: 'No lines on this invoice.' }} />
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          {!!si.taxSen && <>
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Subtotal</span><span className="tabular-nums w-[120px] text-right">{rm(si.subtotalSen ?? si.totalSen - si.taxSen)}</span></div>
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Tax</span><span className="tabular-nums w-[120px] text-right">{rm(si.taxSen)}</span></div>
          </>}
          <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Total</span><span className="tabular-nums w-[120px] text-right">{rm(si.totalSen)}</span></div>
          <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Received</span><span className="tabular-nums w-[120px] text-right">{rm(si.paidSen)}</span></div>
          <div className="flex gap-8 text-[15px] font-semibold"><span>Outstanding</span><span className="tabular-nums w-[120px] text-right">{rm(si.outstandingSen)}</span></div>
        </div>
        {canWrite && si.status !== 'CANCELLED' && si.outstandingSen > 0 && (
          <div className="flex items-center gap-2.5 justify-end">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Record receipt</span>
            <MoneyInput aria-label="Receipt amount (RM)" valueSen={recvSen} onChangeSen={setRecvSen} className="h-9 w-[130px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />
            <Button size="sm" variant="secondary" disabled={!recvSen || recvSen <= 0} disabledReason="Enter an amount" onClick={() => { const amt = Math.min(recvSen ?? 0, si.outstandingSen); onAct(si, { receiveSen: amt }, { paidSen: si.paidSen + amt, outstandingSen: si.outstandingSen - amt }, 'Receipt recorded.'); setRecvSen(null); }}>Record</Button>
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
