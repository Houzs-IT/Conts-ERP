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
import { api } from '../lib/api';
import { persist, useRecord, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date, todayMyt } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';
import { statusLabel } from '../lib/status';

/** Sales Returns — ported from 2990's SCM, drawn in Conts. Sell-side twin of Purchase
 *  Returns: a customer returns goods delivered on a DO; reduces the SO delivered qty and
 *  puts stock back into the dispatch warehouse. Money integer sen. */

type Status = 'POSTED' | 'COMPLETED' | 'CANCELLED';
const FILTERS: (Status | 'all')[] = ['all', 'POSTED', 'COMPLETED', 'CANCELLED'];

interface SretLine { itemCode: string; description: string; uom: string; qtyReturned: number; unitPriceSen: number; lineTotalSen: number; reason: string }
interface Sret { id: string; returnNumber: string; customerName: string; doNumber: string; returnDate: string; status: Status; refundSen: number; creditNoteRef: string; reason: string; notes: string; lines?: SretLine[] }
interface Payload { data: Sret[]; generatedAt: string }
interface DoLine { id: string; itemCode: string; description: string; uom: string; qty: number; returnedQty: number; unitPriceSen: number }
interface OpenDo { id: string; doNumber: string; customerName: string; status: string; lines?: DoLine[] }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'sr1', returnNumber: 'SRET-2026-0001', customerName: 'Vista Jaya Residences', doNumber: 'DO-2026-0001', returnDate: '2026-09-23', status: 'POSTED', refundSen: 328000, creditNoteRef: '', reason: 'Wrong colour delivered', notes: '', lines: [
      { itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qtyReturned: 1, unitPriceSen: 328000, lineTotalSen: 328000, reason: 'Colour mismatch' },
    ] },
  ],
};
const DO_FALLBACK: { data: OpenDo[] } = { data: [
  { id: 'do1', doNumber: 'DO-2026-0002', customerName: 'Arcoris Owner', status: 'DELIVERED', lines: [
    { id: 'dol9', itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qty: 1, returnedQty: 0, unitPriceSen: 189000 },
  ] },
] };

export default function SalesReturnsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/sales-returns', FALLBACK);
  const openDos = (useApi<{ data: OpenDo[] }>('/delivery-orders', DO_FALLBACK).data?.data ?? []).filter(d => d.status !== 'CANCELLED');
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; sret: Sret } | null>(null);
  const [added, setAdded] = useState<Sret[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Sret>>>({});
  useResetOnReload(data, () => {
    setAdded([]); setEdits({});
    setDrawer(d => { const fresh = d?.mode === 'view' ? data?.data.find(x => x.id === d.sret.id) : undefined; return d?.mode === 'view' && fresh ? { mode: 'view', sret: { ...d.sret, ...fresh } } : d; });
  });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.returnNumber} ${p.doNumber} ${p.customerName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Sret>[]>(() => [
    { key: 'returnNumber', label: 'Return', type: 'ref', value: p => p.returnNumber, hideable: false },
    { key: 'customer', label: 'Customer', value: p => p.customerName },
    { key: 'do', label: 'DO', type: 'ref', value: p => p.doNumber || null },
    { key: 'returnDate', label: 'Return date', type: 'date', value: p => p.returnDate || null },
    { key: 'reason', label: 'Reason', value: p => p.reason, render: p => p.reason ? <span className="text-[12.5px] text-muted-ink">{p.reason}</span> : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'sales_return' },
    { key: 'refund', label: 'Refund', type: 'money', value: p => p.status === 'CANCELLED' ? null : p.refundSen, render: p => p.status === 'CANCELLED' ? <span className="text-muted-ink">—</span> : <span className="tabular-nums font-semibold">{rm(p.refundSen)}</span> },
  ], []);

  function created(sret: Sret, req: Promise<unknown>) { setAdded(a => [sret, ...a]); setDrawer(null); persist(req, { reload, ok: () => toast({ tone: 'success', title: 'Return raised.', body: sret.customerName }) }); }
  function patch(p: Sret, status: Status, label: string) {
    setEdits(e => ({ ...e, [p.id]: { ...e[p.id], status } }));
    persist(api.patch(`/sales-returns/${p.id}`, { status }), { reload, ok: () => toast({ tone: 'success', title: label, body: p.returnNumber }) });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Delivery returns" sub={data ? `${all.length} ${all.length === 1 ? 'return' : 'returns'} · from customers` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New return</Button> : undefined} />

      <DataTable<Sret>
        id="scm.sales-returns" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => setDrawer({ mode: 'view', sret: p })}
        noun={['sales return', 'sales returns']} exportName="sales-returns"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : statusLabel('sales_return', f)} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search return, DO or customer..." aria-label="Search sales returns"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No sales returns yet.', body: 'Take back goods a customer returned, against a delivery order.', action: canWrite ? { label: 'New return', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />
      {drawer?.mode === 'new' && <ReturnDrawer openDos={openDos} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer sret={drawer.sret} canWrite={canWrite} onClose={() => setDrawer(null)}
        onComplete={p => patch(p, 'COMPLETED', 'Return completed.')} onCancel={p => patch(p, 'CANCELLED', 'Return cancelled.')} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}

/* ---------- return (create) drawer ---------- */

interface RetLine { doLineId: string; itemCode: string; description: string; uom: string; returnable: number; unitPriceSen: number; qty: number | null; reason: string }

function ReturnDrawer({ openDos, canWrite, onClose, onCreated }: { openDos: OpenDo[]; canWrite: boolean; onClose: () => void; onCreated: (p: Sret, req: Promise<unknown>) => void }) {
  const [doId, setDoId] = useState('');
  const [lines, setLines] = useState<RetLine[]>([]);
  const [returnDate, setReturnDate] = useState(todayMyt());
  const [reason, setReason] = useState('');
  const [creditNoteRef, setCreditNoteRef] = useState('');
  const [notes, setNotes] = useState('');
  const dord = openDos.find(d => d.id === doId);

  async function pick(id: string) {
    setDoId(id);
    const d = openDos.find(x => x.id === id);
    let dl = d?.lines;
    if (!dl) { try { const r = await api.get<{ data: { lines: DoLine[] } }>(`/delivery-orders/${id}`); dl = r.data.lines; } catch { dl = []; } }
    setLines((dl ?? []).filter(l => l.qty - l.returnedQty > 0).map(l => ({ doLineId: l.id, itemCode: l.itemCode, description: l.description, uom: l.uom, returnable: l.qty - l.returnedQty, unitPriceSen: l.unitPriceSen, qty: null, reason: '' })));
  }

  const [submitted, setSubmitted] = useState(false);
  const willReturn = lines.filter(l => (l.qty ?? 0) > 0);
  const refund = willReturn.reduce((s, l) => s + Math.min(l.qty ?? 0, l.returnable) * l.unitPriceSen, 0);
  const canSave = canWrite && doId !== '' && willReturn.length > 0;
  const qtyError = (l: RetLine) => (l.qty ?? 0) > l.returnable ? `Only ${l.returnable} can be returned.` : undefined;
  const today = todayMyt();
  const dateError = submitted && !returnDate ? 'Enter the return date.' : undefined;

  function submit() {
    setSubmitted(true);
    if (!returnDate || willReturn.some(qtyError)) return;
    const payloadLines = willReturn.map(l => ({ deliveryOrderLineId: l.doLineId, itemCode: l.itemCode, description: l.description, uom: l.uom, unitPriceSen: l.unitPriceSen, qtyReturned: l.qty ?? 0, reason: l.reason }));
    const req = api.post('/sales-returns', { deliveryOrderId: doId, returnDate, reason, creditNoteRef, notes, lines: payloadLines });
    onCreated({
      id: `sret-new-${crypto.randomUUID().slice(0, 8)}`, returnNumber: 'Saving…', customerName: dord?.customerName ?? '', doNumber: dord?.doNumber ?? '',
      returnDate, status: 'POSTED', refundSen: refund, creditNoteRef, reason, notes,
      lines: payloadLines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qtyReturned: l.qtyReturned, unitPriceSen: l.unitPriceSen, lineTotalSen: l.qtyReturned * l.unitPriceSen, reason: l.reason })),
    }, req);
  }

  return (
    <Drawer open onClose={onClose} width={860}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New sales return</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Delivery order</label>
            <select value={doId} onChange={e => void pick(e.target.value)}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a delivery order…</option>
              {openDos.map(d => <option key={d.id} value={d.id}>{d.doNumber} · {d.customerName}</option>)}
            </select>
          </div>
          <DateField label="Return date" required max={today} error={dateError} value={returnDate} onChange={setReturnDate} />
          <Field label="Reason" placeholder="e.g. Wrong item" value={reason} onChange={e => setReason(e.target.value)} />
          <Field label="Credit note ref" placeholder="Optional" value={creditNoteRef} onChange={e => setCreditNoteRef(e.target.value)} />
        </div>

        {doId && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines to return</div>
            <div className="overflow-x-auto border border-solid border-line rounded-card">
              <table className="w-full border-collapse min-w-[680px]">
                <thead><tr className="bg-muted">
                  {['Item', 'Returnable', 'Unit price', 'Return qty', 'Line reason'].map((th, i) => (
                    <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 || i === 4 ? 'text-left' : 'text-right')}>{th}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {lines.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-[12.5px] text-muted-ink">This delivery order has nothing left to return.</td></tr>
                  : lines.map((l, i) => (
                    <tr key={l.doLineId} className="[border-top:1px_solid_var(--color-line-soft)]">
                      <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.returnable}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.unitPriceSen)}</td>
                      <td className="py-2 px-3 text-right"><NumberInput aria-label={`Return quantity for ${l.itemCode}`} min={0} max={l.returnable} value={l.qty} error={qtyError(l)} onChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: v } : x))}
                        className="h-8 w-[80px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                      <td className="py-2 px-3"><input value={l.reason} placeholder="Optional" onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))}
                        className="h-8 w-full min-w-[120px] box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex items-end justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Refund value</span><span className="tabular-nums w-[120px] text-right">{rm(refund)}</span></div></div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a delivery order and return at least one line" onClick={submit}>Post return</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view drawer ---------- */

const lineColumns: Column<SretLine>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{l.itemCode}</span>, text: l => `${l.description} ${l.itemCode}` },
  { key: 'qty', label: 'Qty', type: 'number', value: l => l.qtyReturned },
  { key: 'price', label: 'Unit price', type: 'money', value: l => l.unitPriceSen },
  { key: 'total', label: 'Line total', type: 'money', value: l => l.lineTotalSen },
];

function ViewDrawer({ sret, canWrite, onClose, onComplete, onCancel }: { sret: Sret; canWrite: boolean; onClose: () => void; onComplete: (p: Sret) => void; onCancel: (p: Sret) => void }) {
  const { record, loading: linesLoading, error: linesError } = useRecord<Sret>('sales-returns', sret.id);
  const lineRows = useMemo(() => (record?.lines ?? sret.lines ?? []).map((l, i) => ({ ...l, key: String(i) })), [record, sret.lines]);
  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{sret.returnNumber}</h2><StatusBadge entity="sales_return" value={sret.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Customer" value={sret.customerName} />
          <Meta label="Delivery order" value={sret.doNumber || '—'} mono />
          <Meta label="Return date" value={sret.returnDate ? date(sret.returnDate) : '—'} />
          <Meta label="Credit note" value={sret.creditNoteRef || '—'} />
        </div>
        {sret.reason && <div className="text-[13px]"><span className="text-muted-ink">Reason: </span>{sret.reason}</div>}
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<SretLine & { key: string }>
            id="scm.sales-return.lines" urlPrefix="lines." bare noViews noToolbar pageSize={0}
            columns={lineColumns} rows={lineRows} rowKey={l => l.key} loading={linesLoading} error={linesError}
            noun={['line', 'lines']} exportName={`${sret.returnNumber}-lines`}
            empty={{ title: 'No lines on this return.' }} />
        </div>
        <div className="flex justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Refund value</span><span className="tabular-nums w-[120px] text-right">{rm(sret.refundSen)}</span></div></div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && sret.status === 'POSTED' && <ConfirmButton confirm={{ title: `Cancel ${sret.returnNumber}?`, body: 'It is marked Cancelled, the returned goods come back out of stock and count as delivered again.', meta: sret.customerName, confirmLabel: 'Cancel return', cancelLabel: 'Keep return' }} onConfirm={() => onCancel(sret)}>Cancel return</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          {canWrite && sret.status === 'POSTED' && <Button size="sm" variant="secondary" onClick={() => onComplete(sret)}>Mark completed</Button>}
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Drawer>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className={cx('text-[13.5px]', mono ? '[font-family:var(--font-mono,ui-monospace,monospace)]' : '')}>{value}</span></div>;
}
