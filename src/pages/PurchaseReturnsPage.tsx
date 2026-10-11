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
import { api, notifyFailure, ApiFailure } from '../lib/api';
import { persist, useRecord, useResetOnReload } from '../lib/persist';
import { ShortStockPrompt } from '../components/ShortStockPrompt';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';
import { statusLabel } from '../lib/status';

/** Purchase Returns — ported from 2990's SCM, drawn in Conts. Returns GRN-received goods
 *  to the supplier; reduces the GRN net and the PO received qty. Money integer sen. */

type Status = 'POSTED' | 'COMPLETED' | 'CANCELLED';
const FILTERS: (Status | 'all')[] = ['all', 'POSTED', 'COMPLETED', 'CANCELLED'];

interface PretLine { itemCode: string; description: string; uom: string; qtyReturned: number; unitPriceSen: number; lineTotalSen: number; reason: string }
interface Pret { id: string; returnNumber: string; supplierName: string; supplierCode: string; grnNumber: string; returnDate: string; status: Status; refundSen: number; creditNoteRef: string; reason: string; notes: string; lines?: PretLine[] }
interface Payload { data: Pret[]; generatedAt: string }
interface GrnLine { id: string; itemCode: string; description: string; uom: string; qtyAccepted: number; returnedQty: number; unitPriceSen: number }
interface OpenGrn { id: string; grnNumber: string; supplierName: string; status: string; lines?: GrnLine[] }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'pr1', returnNumber: 'PRET-2026-0001', supplierName: 'Hilton Bedding Manufacturing', supplierCode: 'SUP-HILTON', grnNumber: 'GRN-2026-0001', returnDate: '2026-09-23', status: 'POSTED', refundSen: 420000, creditNoteRef: '', reason: 'Damaged in transit', notes: '', lines: [
      { itemCode: 'MT-KG-HIL', description: 'Hilton Pocket Spring Mattress, King', uom: 'UNIT', qtyReturned: 1, unitPriceSen: 420000, lineTotalSen: 420000, reason: 'Torn cover' },
    ] },
  ],
};
const GRN_FALLBACK: { data: OpenGrn[] } = { data: [
  { id: 'grn2', grnNumber: 'GRN-2026-0002', supplierName: 'Nordic Woodcraft', status: 'POSTED', lines: [
    { id: 'grl2', itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qtyAccepted: 2, returnedQty: 0, unitPriceSen: 189000 },
  ] },
] };

export default function PurchaseReturnsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/purchase-returns', FALLBACK);
  const openGrns = (useApi<{ data: OpenGrn[] }>('/goods-receipts?status=POSTED', GRN_FALLBACK).data?.data ?? []).filter(g => g.status === 'POSTED');
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; pret: Pret } | null>(null);
  const [added, setAdded] = useState<Pret[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Pret>>>({});
  useResetOnReload(data, () => {
    setAdded([]); setEdits({});
    setDrawer(d => { const fresh = d?.mode === 'view' ? data?.data.find(x => x.id === d.pret.id) : undefined; return d?.mode === 'view' && fresh ? { mode: 'view', pret: { ...d.pret, ...fresh } } : d; });
  });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.returnNumber} ${p.grnNumber} ${p.supplierName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Pret>[]>(() => [
    { key: 'returnNumber', label: 'Return', type: 'ref', value: p => p.returnNumber, hideable: false },
    { key: 'supplier', label: 'Supplier', value: p => p.supplierName, sub: p => p.supplierCode, text: p => `${p.supplierName} ${p.supplierCode}` },
    { key: 'grnNumber', label: 'GRN', type: 'ref', value: p => p.grnNumber || null },
    { key: 'returnDate', label: 'Return date', type: 'date', value: p => p.returnDate || null },
    { key: 'reason', label: 'Reason', value: p => p.reason || null, render: p => p.reason ? <span className="block max-w-[200px] truncate text-muted-ink" title={p.reason}>{p.reason}</span> : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'purchase_return' },
    { key: 'refund', label: 'Refund', type: 'money', value: p => p.status === 'CANCELLED' ? null : p.refundSen },
  ], []);

  function created(pret: Pret) { setAdded(a => [pret, ...a]); reload(); toast({ tone: 'success', title: 'Return raised.', body: `${pret.returnNumber} · ${pret.supplierName}` }); setDrawer(null); }
  function patch(p: Pret, status: Status, label: string) {
    setEdits(e => ({ ...e, [p.id]: { ...e[p.id], status } }));
    persist(api.patch(`/purchase-returns/${p.id}`, { status }), { reload, ok: () => toast({ tone: 'success', title: label, body: p.returnNumber }) });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Purchase returns" sub={`${all.length} ${all.length === 1 ? 'return' : 'returns'} · to suppliers`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New return</Button> : undefined} />

      <DataTable<Pret>
        id="scm.purchase-returns" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => setDrawer({ mode: 'view', pret: p })}
        noun={['purchase return', 'purchase returns']} exportName="purchase-returns"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : statusLabel('purchase_return', f)} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search return, GRN or supplier..." aria-label="Search purchase returns"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No purchase returns yet.', body: 'Return received goods to a supplier against a goods receipt.', action: canWrite ? { label: 'New return', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />

      {drawer?.mode === 'new' && <ReturnDrawer openGrns={openGrns} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer pret={drawer.pret} canWrite={canWrite} onClose={() => setDrawer(null)}
        onComplete={p => patch(p, 'COMPLETED', 'Return completed.')} onCancel={p => patch(p, 'CANCELLED', 'Return cancelled.')} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}

/* ---------- return (create) drawer ---------- */

interface RetLine { grnLineId: string; itemCode: string; description: string; uom: string; returnable: number; unitPriceSen: number; qty: number | null; reason: string }

function ReturnDrawer({ openGrns, canWrite, onClose, onCreated }: { openGrns: OpenGrn[]; canWrite: boolean; onClose: () => void; onCreated: (p: Pret) => void }) {
  const [grnId, setGrnId] = useState('');
  const [lines, setLines] = useState<RetLine[]>([]);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [creditNoteRef, setCreditNoteRef] = useState('');
  const [notes, setNotes] = useState('');
  const grn = openGrns.find(g => g.id === grnId);

  async function pick(id: string) {
    setGrnId(id);
    const g = openGrns.find(x => x.id === id);
    let gl = g?.lines;
    if (!gl) { try { const r = await api.get<{ data: { lines: GrnLine[] } }>(`/goods-receipts/${id}`); gl = r.data.lines; } catch { gl = []; } }
    setLines((gl ?? []).filter(l => l.qtyAccepted - l.returnedQty > 0).map(l => ({ grnLineId: l.id, itemCode: l.itemCode, description: l.description, uom: l.uom, returnable: l.qtyAccepted - l.returnedQty, unitPriceSen: l.unitPriceSen, qty: null, reason: '' })));
  }

  const willReturn = lines.filter(l => (l.qty ?? 0) > 0);
  const refund = willReturn.reduce((s, l) => s + (l.qty ?? 0) * l.unitPriceSen, 0);
  const canSave = canWrite && grnId !== '' && willReturn.length > 0;

  const [busy, setBusy] = useState(false);
  const [shortStock, setShortStock] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const dateError = fields.returnDate ?? (tried && !returnDate ? 'Required.' : undefined);
  const qtyError = (l: RetLine) => fields[`lines.${willReturn.indexOf(l)}.qtyReturned`];

  // Waits for the server: a refused return must never show as raised.
  async function submit(confirmShortStock = false) {
    setTried(true);
    if (!returnDate || willReturn.some(l => (l.qty ?? 0) > l.returnable)) return;
    const payloadLines = willReturn.map(l => ({ grnLineId: l.grnLineId, itemCode: l.itemCode, description: l.description, uom: l.uom, unitPriceSen: l.unitPriceSen, qtyReturned: l.qty ?? 0, reason: l.reason }));
    setFields({});
    setBusy(true);
    try {
      const r = await api.post<{ id: string; returnNumber: string }>('/purchase-returns', { grnId, returnDate, reason, creditNoteRef, notes, lines: payloadLines, confirmShortStock: confirmShortStock || undefined });
      onCreated({
        id: r.id, returnNumber: r.returnNumber, supplierName: grn?.supplierName ?? '', supplierCode: '', grnNumber: grn?.grnNumber ?? '',
        returnDate, status: 'POSTED', refundSen: refund, creditNoteRef, reason, notes,
        lines: payloadLines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qtyReturned: l.qtyReturned, unitPriceSen: l.unitPriceSen, lineTotalSen: l.qtyReturned * l.unitPriceSen, reason: l.reason })),
      });
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'SHORT_STOCK') setShortStock(e.message);
      else { if (e instanceof ApiFailure && e.fields) setFields(e.fields); notifyFailure(e); }
    } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width={860}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New purchase return</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Goods receipt</label>
            <select value={grnId} onChange={e => void pick(e.target.value)}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a posted GRN…</option>
              {openGrns.map(g => <option key={g.id} value={g.id}>{g.grnNumber} · {g.supplierName}</option>)}
            </select>
          </div>
          <DateField label="Return date" required max={new Date().toISOString().slice(0, 10)} value={returnDate} onChange={setReturnDate} error={dateError} />
          <Field label="Reason" placeholder="e.g. Damaged" value={reason} onChange={e => setReason(e.target.value)} />
          <Field label="Credit note ref" placeholder="Optional" value={creditNoteRef} onChange={e => setCreditNoteRef(e.target.value)} />
        </div>

        {grnId && (
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
                  {lines.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-[12.5px] text-muted-ink">This GRN has nothing left to return.</td></tr>
                  : lines.map((l, i) => (
                    <tr key={l.grnLineId} className="[border-top:1px_solid_var(--color-line-soft)]">
                      <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.returnable}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.unitPriceSen)}</td>
                      <td className="py-2 px-3 text-right"><NumberInput aria-label="Return quantity" min={0} max={l.returnable} value={l.qty} error={qtyError(l)} onChange={v => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: v } : x))}
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
        {shortStock && <ShortStockPrompt message={shortStock} actionLabel="Return anyway" busy={busy} onCancel={() => setShortStock(null)} onConfirm={() => void submit(true)} />}
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave || !!shortStock} disabledReason={shortStock ? 'Answer the stock question above first' : 'Pick a GRN and return at least one line'} loading={busy && !shortStock} onClick={() => void submit()}>Post return</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view drawer ---------- */

const LINE_COLUMNS: Column<PretLine & { i: number }>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{l.itemCode}</span>, text: l => `${l.description} ${l.itemCode}`, hideable: false },
  { key: 'qty', label: 'Qty', type: 'number', value: l => l.qtyReturned },
  { key: 'unitPrice', label: 'Unit price', type: 'money', value: l => l.unitPriceSen },
  { key: 'lineTotal', label: 'Line total', type: 'money', value: l => l.lineTotalSen },
];

function ViewDrawer({ pret, canWrite, onClose, onComplete, onCancel }: { pret: Pret; canWrite: boolean; onClose: () => void; onComplete: (p: Pret) => void; onCancel: (p: Pret) => void }) {
  const { record, loading: linesLoading, error: linesError } = useRecord<Pret>('purchase-returns', pret.id);
  return (
    <Drawer open onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{pret.returnNumber}</h2><StatusBadge entity="purchase_return" value={pret.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Supplier" value={pret.supplierName} />
          <Meta label="GRN" value={pret.grnNumber || '—'} mono />
          <Meta label="Return date" value={pret.returnDate ? date(pret.returnDate) : '—'} />
          <Meta label="Credit note" value={pret.creditNoteRef || '—'} />
        </div>
        {pret.reason && <div className="text-[13px]"><span className="text-muted-ink">Reason: </span>{pret.reason}</div>}
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<PretLine & { i: number }>
            id="scm.purchase-return.lines" urlPrefix="lines." columns={LINE_COLUMNS} rows={(record?.lines ?? pret.lines ?? []).map((l, i) => ({ ...l, i }))} rowKey={l => String(l.i)} loading={linesLoading} error={linesError}
            bare noViews noToolbar pageSize={0} noun={['line', 'lines']} exportName={`${pret.returnNumber}-lines`}
            empty={{ title: 'No lines on this return.' }} />
        </div>
        <div className="flex justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Refund value</span><span className="tabular-nums w-[120px] text-right">{rm(pret.refundSen)}</span></div></div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && pret.status === 'POSTED' && <ConfirmButton confirm={{ title: `Cancel ${pret.returnNumber}?`, body: 'It is marked Cancelled and the returned goods are put back into stock.', meta: pret.supplierName, confirmLabel: 'Cancel return', cancelLabel: 'Keep return' }} onConfirm={() => onCancel(pret)}>Cancel return</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          {canWrite && pret.status === 'POSTED' && <Button size="sm" variant="secondary" onClick={() => onComplete(pret)}>Mark completed</Button>}
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Drawer>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className={cx('text-[13.5px]', mono ? '[font-family:var(--font-mono,ui-monospace,monospace)]' : '')}>{value}</span></div>;
}
