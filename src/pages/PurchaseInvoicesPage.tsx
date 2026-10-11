import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { NumberInput, DateField } from '../components/inputs';
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

/** Purchase Invoices — ported from 2990's SCM, drawn in Conts. Bills a GRN's accepted
 *  lines; payments post later via Payment Vouchers. Money integer sen. */

type Status = 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
const FILTERS: (Status | 'all')[] = ['all', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];

interface PiLine { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; lineTotalSen: number }
interface Pi { id: string; invoiceNumber: string; supplierInvoiceRef: string; supplierName: string; supplierCode: string; grnNumber: string; poNumber: string; invoiceDate: string; dueDate: string; status: Status; totalSen: number; paidSen: number; outstandingSen: number; notes: string; lines?: PiLine[] }
interface Payload { data: Pi[]; generatedAt: string }
interface GrnLine { id: string; itemCode: string; description: string; uom: string; qtyAccepted: number; invoicedQty: number; unitPriceSen: number }
interface OpenGrn { id: string; grnNumber: string; supplierName: string; poNumber: string; status: string; lines?: GrnLine[] }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'pi1', invoiceNumber: 'PINV-2026-0001', supplierInvoiceRef: 'INV-99321', supplierName: 'Nordic Woodcraft', supplierCode: 'SUP-NORDIC', grnNumber: 'GRN-2026-0002', poNumber: 'PO-2026-0003', invoiceDate: '2026-09-20', dueDate: '2026-10-20', status: 'POSTED', totalSen: 378000, paidSen: 0, outstandingSen: 378000, notes: '', lines: [
      { itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qty: 2, unitPriceSen: 189000, lineTotalSen: 378000 },
    ] },
    { id: 'pi2', invoiceNumber: 'PINV-2026-0002', supplierInvoiceRef: 'HB-2261', supplierName: 'Hilton Bedding Manufacturing', supplierCode: 'SUP-HILTON', grnNumber: 'GRN-2026-0001', poNumber: 'PO-2026-0002', invoiceDate: '2026-09-22', dueDate: '2026-11-21', status: 'PARTIALLY_PAID', totalSen: 420000, paidSen: 200000, outstandingSen: 220000, notes: '', lines: [
      { itemCode: 'MT-KG-HIL', description: 'Hilton Pocket Spring Mattress, King', uom: 'UNIT', qty: 1, unitPriceSen: 420000, lineTotalSen: 420000 },
    ] },
  ],
};
const GRN_FALLBACK: { data: OpenGrn[] } = { data: [
  { id: 'grn1', grnNumber: 'GRN-2026-0001', supplierName: 'Hilton Bedding Manufacturing', poNumber: 'PO-2026-0002', status: 'POSTED', lines: [
    { id: 'grl1', itemCode: 'MT-KG-HIL', description: 'Hilton Pocket Spring Mattress, King', uom: 'UNIT', qtyAccepted: 1, invoicedQty: 1, unitPriceSen: 420000 },
  ] },
  { id: 'grn2', grnNumber: 'GRN-2026-0002', supplierName: 'Nordic Woodcraft', poNumber: 'PO-2026-0003', status: 'POSTED', lines: [
    { id: 'grl2', itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qtyAccepted: 2, invoicedQty: 0, unitPriceSen: 189000 },
  ] },
] };

export default function PurchaseInvoicesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/purchase-invoices', FALLBACK);
  const openGrns = (useApi<{ data: OpenGrn[] }>('/goods-receipts?status=POSTED', GRN_FALLBACK).data?.data ?? []).filter(g => g.status === 'POSTED');
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; pi: Pi } | null>(null);
  const [added, setAdded] = useState<Pi[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Pi>>>({});
  useResetOnReload(data, () => {
    setAdded([]); setEdits({});
    setDrawer(d => { const fresh = d?.mode === 'view' ? data?.data.find(x => x.id === d.pi.id) : undefined; return d?.mode === 'view' && fresh ? { mode: 'view', pi: { ...d.pi, ...fresh } } : d; });
  });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.invoiceNumber} ${p.supplierInvoiceRef} ${p.supplierName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Pi>[]>(() => [
    { key: 'invoiceNumber', label: 'Invoice', type: 'ref', value: p => p.invoiceNumber, sub: p => p.supplierInvoiceRef || null, hideable: false },
    { key: 'supplierRef', label: 'Supplier ref', value: p => p.supplierInvoiceRef, hidden: true },
    { key: 'supplier', label: 'Supplier', value: p => p.supplierName, sub: p => p.supplierCode, text: p => `${p.supplierName} ${p.supplierCode}` },
    { key: 'grnNumber', label: 'GRN', type: 'ref', value: p => p.grnNumber || null },
    { key: 'invoiceDate', label: 'Invoice date', type: 'date', value: p => p.invoiceDate || null },
    { key: 'dueDate', label: 'Due', type: 'date', value: p => p.dueDate || null },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'purchase_invoice' },
    { key: 'total', label: 'Total', type: 'money', value: p => p.totalSen },
    { key: 'outstanding', label: 'Outstanding', type: 'money', value: p => p.status === 'CANCELLED' ? null : p.outstandingSen },
  ], []);

  function created(pi: Pi, req: Promise<unknown>) { setAdded(a => [pi, ...a]); setDrawer(null); persist(req, { reload, ok: () => toast({ tone: 'success', title: 'Purchase invoice posted.', body: pi.supplierName }) }); }
  function cancel(p: Pi) {
    setEdits(e => ({ ...e, [p.id]: { ...e[p.id], status: 'CANCELLED' } }));
    persist(api.patch(`/purchase-invoices/${p.id}`, { status: 'CANCELLED' }), { reload, ok: () => toast({ tone: 'success', title: 'Invoice cancelled.', body: p.invoiceNumber }) });
    setDrawer(null);
  }

  const totalOutstanding = all.filter(p => p.status !== 'CANCELLED').reduce((s, p) => s + p.outstandingSen, 0);

  return (
    <>
      <PageHeader title="Purchase invoices" sub={data ? `${all.length} ${all.length === 1 ? 'invoice' : 'invoices'} · ${rm(totalOutstanding, { cents: false })} outstanding` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New invoice</Button> : undefined} />

      <DataTable<Pi>
        id="scm.purchase-invoices" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => setDrawer({ mode: 'view', pi: p })}
        noun={['purchase invoice', 'purchase invoices']} exportName="purchase-invoices"
        toolbar={<>
          <Segmented label="Status" options={FILTERS.map(f => ({ key: f, label: f === 'all' ? 'All' : statusLabel('purchase_invoice', f) }))} value={statusFilter} onChange={setStatusFilter} />
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice or supplier..." aria-label="Search purchase invoices"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No purchase invoices yet.', body: 'Bill a goods receipt to record a supplier invoice.', action: canWrite ? { label: 'New invoice', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />

      {drawer?.mode === 'new' && <BillDrawer openGrns={openGrns} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer pi={drawer.pi} canWrite={canWrite} onClose={() => setDrawer(null)} onCancel={cancel} />}
    </>
  );
}

/* ---------- bill (create) drawer ---------- */

interface BillLine { grnLineId: string; itemCode: string; description: string; uom: string; outstanding: number; unitPriceSen: number; qty: number | null }

function BillDrawer({ openGrns, canWrite, onClose, onCreated }: { openGrns: OpenGrn[]; canWrite: boolean; onClose: () => void; onCreated: (p: Pi, req: Promise<unknown>) => void }) {
  const [grnId, setGrnId] = useState('');
  const [lines, setLines] = useState<BillLine[]>([]);
  const [ref, setRef] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayMyt());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const grn = openGrns.find(g => g.id === grnId);

  async function pick(id: string) {
    setGrnId(id);
    const g = openGrns.find(x => x.id === id);
    let gl = g?.lines;
    if (!gl) { try { const r = await api.get<{ data: { lines: GrnLine[] } }>(`/goods-receipts/${id}`); gl = r.data.lines; } catch { gl = []; } }
    setLines((gl ?? []).filter(l => l.qtyAccepted - l.invoicedQty > 0).map(l => ({ grnLineId: l.id, itemCode: l.itemCode, description: l.description, uom: l.uom, outstanding: l.qtyAccepted - l.invoicedQty, unitPriceSen: l.unitPriceSen, qty: l.qtyAccepted - l.invoicedQty })));
  }

  const willBill = lines.filter(l => (l.qty ?? 0) > 0);
  const total = willBill.reduce((s, l) => s + (l.qty ?? 0) * l.unitPriceSen, 0);
  const canSave = canWrite && grnId !== '' && willBill.length > 0;
  const [tried, setTried] = useState(false);
  const dateError = tried && !invoiceDate ? 'Required.' : undefined;

  function submit() {
    setTried(true);
    if (!invoiceDate || willBill.some(l => (l.qty ?? 0) > l.outstanding)) return;
    const payloadLines = willBill.map(l => ({ grnLineId: l.grnLineId, itemCode: l.itemCode, description: l.description, uom: l.uom, unitPriceSen: l.unitPriceSen, qty: l.qty ?? 0 }));
    const req = api.post('/purchase-invoices', { grnId, supplierInvoiceRef: ref, invoiceDate, dueDate: dueDate || null, notes, lines: payloadLines });
    onCreated({
      id: `pi-new-${crypto.randomUUID().slice(0, 8)}`, invoiceNumber: 'Saving…', supplierInvoiceRef: ref, supplierName: grn?.supplierName ?? '', supplierCode: '',
      grnNumber: grn?.grnNumber ?? '', poNumber: grn?.poNumber ?? '', invoiceDate, dueDate, status: 'POSTED', totalSen: total, paidSen: 0, outstandingSen: total, notes,
      lines: payloadLines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen, lineTotalSen: l.qty * l.unitPriceSen })),
    }, req);
  }

  return (
    <Drawer open onClose={onClose} width={860}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New purchase invoice</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Goods receipt</label>
            <select value={grnId} onChange={e => void pick(e.target.value)}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a posted GRN…</option>
              {openGrns.map(g => <option key={g.id} value={g.id}>{g.grnNumber} · {g.supplierName}</option>)}
            </select>
          </div>
          <Field label="Supplier invoice ref" placeholder="Optional" value={ref} onChange={e => setRef(e.target.value)} />
          <DateField label="Invoice date" required value={invoiceDate} onChange={setInvoiceDate} error={dateError} />
          <DateField label="Due date" value={dueDate} min={invoiceDate || undefined} onChange={setDueDate} />
        </div>

        {grnId && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines to bill</div>
            <div className="overflow-x-auto border border-solid border-line rounded-card">
              <table className="w-full border-collapse min-w-[640px]">
                <thead><tr className="bg-muted">
                  {['Item', 'Outstanding', 'Unit price', 'Bill qty', 'Line total'].map((th, i) => (
                    <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {lines.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-[12.5px] text-muted-ink">This GRN has nothing left to invoice.</td></tr>
                  : lines.map((l, i) => (
                    <tr key={l.grnLineId} className="[border-top:1px_solid_var(--color-line-soft)]">
                      <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.outstanding}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.unitPriceSen)}</td>
                      <td className="py-2 px-3 text-right"><NumberInput aria-label="Bill quantity" min={0} max={l.outstanding} value={l.qty} onChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: v } : x))}
                        className="h-8 w-[80px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm((l.qty ?? 0) * l.unitPriceSen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex items-end justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Invoice total</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div></div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a GRN and bill at least one line" onClick={submit}>Post invoice</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view drawer ---------- */

const LINE_COLUMNS: Column<PiLine & { i: number }>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{l.itemCode}</span>, text: l => `${l.description} ${l.itemCode}`, hideable: false },
  { key: 'qty', label: 'Qty', type: 'number', value: l => l.qty },
  { key: 'unitPrice', label: 'Unit price', type: 'money', value: l => l.unitPriceSen },
  { key: 'lineTotal', label: 'Line total', type: 'money', value: l => l.lineTotalSen },
];

function ViewDrawer({ pi, canWrite, onClose, onCancel }: { pi: Pi; canWrite: boolean; onClose: () => void; onCancel: (p: Pi) => void }) {
  const { record, loading: linesLoading, error: linesError } = useRecord<Pi>('purchase-invoices', pi.id);
  return (
    <Drawer open onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{pi.invoiceNumber}</h2><StatusBadge entity="purchase_invoice" value={pi.status} /></div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Supplier" value={pi.supplierName} />
          <Meta label="Supplier ref" value={pi.supplierInvoiceRef || '—'} />
          <Meta label="GRN" value={pi.grnNumber || '—'} mono />
          <Meta label="Due" value={pi.dueDate ? date(pi.dueDate) : '—'} />
        </div>
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<PiLine & { i: number }>
            id="scm.purchase-invoice.lines" urlPrefix="lines." columns={LINE_COLUMNS} rows={(record?.lines ?? pi.lines ?? []).map((l, i) => ({ ...l, i }))} rowKey={l => String(l.i)} loading={linesLoading} error={linesError}
            bare noViews noToolbar pageSize={0} noun={['line', 'lines']} exportName={`${pi.invoiceNumber}-lines`}
            empty={{ title: 'No lines on this invoice.' }} />
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Total</span><span className="tabular-nums w-[120px] text-right">{rm(pi.totalSen)}</span></div>
          <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Paid</span><span className="tabular-nums w-[120px] text-right">{rm(pi.paidSen)}</span></div>
          <div className="flex gap-8 text-[15px] font-semibold"><span>Outstanding</span><span className="tabular-nums w-[120px] text-right">{rm(pi.outstandingSen)}</span></div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && pi.status !== 'CANCELLED' && pi.paidSen === 0 && <ConfirmButton confirm={{ title: `Cancel ${pi.invoiceNumber}?`, body: 'It is marked Cancelled and the goods receipt it billed can be invoiced again.', meta: `${pi.supplierName} · ${rm(pi.totalSen)}`, confirmLabel: 'Cancel invoice', cancelLabel: 'Keep invoice' }} onConfirm={() => onCancel(pi)}>Cancel invoice</ConfirmButton>}</div>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Drawer>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className={cx('text-[13.5px]', mono ? '[font-family:var(--font-mono,ui-monospace,monospace)]' : '')}>{value}</span></div>;
}
