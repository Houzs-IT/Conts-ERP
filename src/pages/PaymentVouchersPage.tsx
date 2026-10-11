import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date, todayMyt } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';

/** Payment Vouchers (AP) — ported from 2990's SCM, drawn in Conts. A voucher pays a
 *  supplier's outstanding purchase invoices, driving each invoice's paid status. */

const METHODS = ['TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'OTHER'] as const;
const METHOD_LABEL: Record<string, string> = { TRANSFER: 'Bank transfer', CASH: 'Cash', CHEQUE: 'Cheque', CARD: 'Card', OTHER: 'Other' };

interface Alloc { invoiceNumber: string; amountSen: number }
interface Pv { id: string; voucherNumber: string; supplierName: string; supplierCode: string; supplierId: string; paymentDate: string; method: string; reference: string; amountSen: number; status: 'POSTED' | 'CANCELLED'; notes: string; allocations?: Alloc[] }
interface Payload { data: Pv[]; generatedAt: string }
interface Opt { id: string; code: string; name: string }
interface Pi { id: string; invoiceNumber: string; supplierId: string; invoiceDate: string; totalSen: number; paidSen: number; outstandingSen: number; status: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'pv1', voucherNumber: 'PV-2026-0001', supplierName: 'Hilton Bedding Manufacturing', supplierCode: 'SUP-HILTON', supplierId: 's2', paymentDate: '2026-09-22', method: 'TRANSFER', reference: 'TT-55231', amountSen: 200000, status: 'POSTED', notes: '', allocations: [{ invoiceNumber: 'PINV-2026-0002', amountSen: 200000 }] },
  ],
};
const SUP_FALLBACK = { data: [
  { id: 's1', code: 'SUP-EMMA', name: 'Emma Furnishings Sdn Bhd' }, { id: 's2', code: 'SUP-HILTON', name: 'Hilton Bedding Manufacturing' }, { id: 's3', code: 'SUP-NORDIC', name: 'Nordic Woodcraft' },
] };
const PI_FALLBACK: { data: Pi[] } = { data: [
  { id: 'pi1', invoiceNumber: 'PINV-2026-0001', supplierId: 's3', invoiceDate: '2026-09-20', totalSen: 378000, paidSen: 0, outstandingSen: 378000, status: 'POSTED' },
  { id: 'pi2', invoiceNumber: 'PINV-2026-0002', supplierId: 's2', invoiceDate: '2026-09-22', totalSen: 420000, paidSen: 200000, outstandingSen: 220000, status: 'PARTIALLY_PAID' },
] };

export default function PaymentVouchersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/payment-vouchers', FALLBACK);
  const suppliers = useApi<{ data: Opt[] }>('/suppliers', SUP_FALLBACK).data?.data ?? [];
  const invoices = (useApi<{ data: Pi[] }>('/purchase-invoices', PI_FALLBACK).data?.data ?? []).filter(p => p.status === 'POSTED' || p.status === 'PARTIALLY_PAID');
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<'all' | 'POSTED' | 'CANCELLED'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; pv: Pv } | null>(null);
  const [added, setAdded] = useState<Pv[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Pv>>>({});

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.voucherNumber} ${p.reference} ${p.supplierName}`.toLowerCase().includes(q)));
  const paidTotal = all.filter(p => p.status === 'POSTED').reduce((s, p) => s + p.amountSen, 0);

  const columns = useMemo<Column<Pv>[]>(() => [
    { key: 'voucherNumber', label: 'Voucher', type: 'ref', value: p => p.voucherNumber, hideable: false },
    { key: 'supplier', label: 'Supplier', value: p => p.supplierName, sub: p => p.supplierCode, text: p => `${p.supplierName} ${p.supplierCode}` },
    { key: 'paymentDate', label: 'Date', type: 'date', value: p => p.paymentDate || null },
    { key: 'method', label: 'Method', value: p => p.method, text: p => METHOD_LABEL[p.method] ?? p.method, filter: { kind: 'select' } },
    { key: 'reference', label: 'Reference', value: p => p.reference || null },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, status: p => p.status === 'POSTED' ? { label: 'Posted', tone: 'success' } : { label: 'Cancelled', tone: 'neutral' } },
    { key: 'amount', label: 'Amount', type: 'money', value: p => p.amountSen, render: p => p.status === 'CANCELLED' ? <span className="tabular-nums text-muted-ink line-through">{rm(p.amountSen)}</span> : <span className="tabular-nums">{rm(p.amountSen)}</span> },
  ], []);

  function created(pv: Pv) { setAdded(a => [pv, ...a]); toast({ tone: 'success', title: 'Payment recorded.', body: `${pv.voucherNumber} · ${rm(pv.amountSen)}` }); setDrawer(null); }
  function cancel(p: Pv) {
    setEdits(e => ({ ...e, [p.id]: { ...e[p.id], status: 'CANCELLED' } }));
    api.patch(`/payment-vouchers/${p.id}`, { status: 'CANCELLED' }).catch(notifyFailure);
    toast({ tone: 'success', title: 'Payment voucher cancelled.', body: p.voucherNumber });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Payment vouchers" sub={`${all.length} vouchers · ${rm(paidTotal, { cents: false })} paid`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>Record payment</Button> : undefined} />

      <DataTable<Pv>
        id="scm.payment-vouchers" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => setDrawer({ mode: 'view', pv: p })}
        noun={['payment voucher', 'payment vouchers']} exportName="payment-vouchers"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'POSTED', 'CANCELLED'] as const).map(f => <Chip key={f} label={f === 'all' ? 'All' : f === 'POSTED' ? 'Posted' : 'Cancelled'} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}
          </div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search voucher or supplier..." aria-label="Search payment vouchers"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No payments recorded yet.', body: "Record a payment to settle a supplier's outstanding invoices.", action: canWrite ? { label: 'Record payment', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />

      {drawer?.mode === 'new' && <PayDrawer suppliers={suppliers} invoices={invoices} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer pv={drawer.pv} canWrite={canWrite} onClose={() => setDrawer(null)} onCancel={cancel} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}

/* ---------- pay (create) drawer ---------- */

interface PayLine { invoiceId: string; invoiceNumber: string; invoiceDate: string; outstanding: number; paySen: number | null }

function PayDrawer({ suppliers, invoices, canWrite, onClose, onCreated }: { suppliers: Opt[]; invoices: Pi[]; canWrite: boolean; onClose: () => void; onCreated: (p: Pv) => void }) {
  const [supplierId, setSupplierId] = useState('');
  const [method, setMethod] = useState<string>('TRANSFER');
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayMyt());
  const [notes, setNotes] = useState('');
  const [pays, setPays] = useState<Record<string, number | null>>({});

  const supplier = suppliers.find(s => s.id === supplierId);
  const supplierInvoices = invoices.filter(p => p.supplierId === supplierId && p.outstandingSen > 0);
  const lines: PayLine[] = supplierInvoices.map(p => ({ invoiceId: p.id, invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate, outstanding: p.outstandingSen, paySen: pays[p.id] ?? null }));
  const amount = lines.reduce((s, l) => s + (l.paySen ?? 0), 0);
  const canSave = canWrite && supplierId !== '' && amount > 0;
  const [tried, setTried] = useState(false);
  const dateError = tried && !paymentDate ? 'Required.' : undefined;

  function payAll() { const next: Record<string, number | null> = {}; supplierInvoices.forEach(p => { next[p.id] = p.outstandingSen; }); setPays(next); }

  function submit() {
    setTried(true);
    if (!paymentDate || lines.some(l => (l.paySen ?? 0) > l.outstanding)) return;
    const allocations = lines
      .map(l => ({ purchaseInvoiceId: l.invoiceId, amountSen: l.paySen ?? 0, invoiceNumber: l.invoiceNumber }))
      .filter(a => a.amountSen > 0);
    api.post('/payment-vouchers', { supplierId, paymentDate, method, reference, notes, allocations: allocations.map(({ purchaseInvoiceId, amountSen }) => ({ purchaseInvoiceId, amountSen })) }).catch(notifyFailure);
    onCreated({
      id: `pv-new-${crypto.randomUUID().slice(0, 8)}`, voucherNumber: `PV-${todayMyt().slice(0, 4)}-NEW`, supplierName: supplier?.name ?? '', supplierCode: supplier?.code ?? '', supplierId,
      paymentDate, method, reference, amountSen: amount, status: 'POSTED', notes, allocations: allocations.map(a => ({ invoiceNumber: a.invoiceNumber, amountSen: a.amountSen })),
    });
  }

  return (
    <Drawer open onClose={onClose} width={820}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">Record payment</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Supplier</label>
            <select value={supplierId} onChange={e => { setSupplierId(e.target.value); setPays({}); }}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              {METHODS.map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </select>
          </div>
          <DateField label="Payment date" required value={paymentDate} onChange={setPaymentDate} error={dateError} />
          <Field label="Reference" placeholder="Cheque / txn no" value={reference} onChange={e => setReference(e.target.value)} />
        </div>

        {supplierId && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Outstanding invoices</div>
              {supplierInvoices.length > 0 && <button onClick={payAll} className="text-[12px] font-semibold text-gold-ink bg-transparent border-none cursor-pointer">Pay all outstanding</button>}
            </div>
            <div className="overflow-x-auto border border-solid border-line rounded-card">
              <table className="w-full border-collapse min-w-[560px]">
                <thead><tr className="bg-muted">
                  {['Invoice', 'Invoice date', 'Outstanding', 'Pay now'].map((th, i) => (
                    <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 || i === 1 ? 'text-left' : 'text-right')}>{th}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {supplierInvoices.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-[12.5px] text-muted-ink">This supplier has no outstanding invoices.</td></tr>
                  : lines.map(l => (
                    <tr key={l.invoiceId} className="[border-top:1px_solid_var(--color-line-soft)]">
                      <td className="py-2 px-3 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px]">{l.invoiceNumber}</td>
                      <td className="py-2 px-3 text-[13px] text-muted-ink">{l.invoiceDate ? date(l.invoiceDate) : '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.outstanding)}</td>
                      <td className="py-2 px-3 text-right"><MoneyInput aria-label="Pay now" maxSen={l.outstanding} valueSen={l.paySen} onChangeSen={v => setPays(p => ({ ...p, [l.invoiceId]: v }))}
                        className="h-8 w-[110px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex items-end justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Payment total</span><span className="tabular-nums w-[120px] text-right">{rm(amount)}</span></div></div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a supplier and allocate a payment" onClick={submit}>Post payment</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view drawer ---------- */

const ALLOC_COLUMNS: Column<Alloc & { i: number }>[] = [
  { key: 'invoice', label: 'Invoice', type: 'ref', value: a => a.invoiceNumber, hideable: false },
  { key: 'allocated', label: 'Allocated', type: 'money', value: a => a.amountSen },
];

function ViewDrawer({ pv, canWrite, onClose, onCancel }: { pv: Pv; canWrite: boolean; onClose: () => void; onCancel: (p: Pv) => void }) {
  return (
    <Drawer open onClose={onClose} width={620}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{pv.voucherNumber}</h2><StatusBadge entity="payment_voucher" value={pv.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Supplier" value={pv.supplierName} />
          <Meta label="Date" value={pv.paymentDate ? date(pv.paymentDate) : '—'} />
          <Meta label="Method" value={METHOD_LABEL[pv.method] ?? pv.method} />
          <Meta label="Reference" value={pv.reference || '—'} />
        </div>
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<Alloc & { i: number }>
            id="scm.payment-voucher.allocations" urlPrefix="alloc." columns={ALLOC_COLUMNS} rows={(pv.allocations ?? []).map((a, i) => ({ ...a, i }))} rowKey={a => String(a.i)}
            bare noViews noToolbar pageSize={0} noun={['allocation', 'allocations']} exportName={`${pv.voucherNumber}-allocations`}
            empty={{ title: 'No invoices on this voucher.' }} />
        </div>
        <div className="flex justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Total paid</span><span className="tabular-nums w-[120px] text-right">{rm(pv.amountSen)}</span></div></div>
        {pv.notes && <div className="text-[13px]"><span className="text-muted-ink">Notes: </span>{pv.notes}</div>}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && pv.status === 'POSTED' && <ConfirmButton confirm={{ title: `Cancel ${pv.voucherNumber}?`, body: 'It is marked Cancelled and the invoices it paid show those amounts as unpaid again.', meta: `${pv.supplierName} · ${rm(pv.amountSen)}`, confirmLabel: 'Cancel voucher', cancelLabel: 'Keep voucher' }} onConfirm={() => onCancel(pv)}>Cancel voucher</ConfirmButton>}</div>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Drawer>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className="text-[13.5px]">{value}</span></div>;
}
