import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/** Sales Order Amendment — ported from 2990's SCM (core workflow), drawn in Conts. Amend a
 *  confirmed SO through REQUESTED -> APPROVED -> APPLIED (or REJECTED / CANCELLED); applying
 *  rewrites the SO lines. Money integer sen. */

type Status = 'REQUESTED' | 'APPROVED' | 'APPLIED' | 'REJECTED' | 'CANCELLED';
const STATUS_LABEL: Record<Status, string> = { REQUESTED: 'Requested', APPROVED: 'Approved', APPLIED: 'Applied', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, Tone> = { REQUESTED: 'info', APPROVED: 'warning', APPLIED: 'success', REJECTED: 'critical', CANCELLED: 'neutral' };
const FILTERS: (Status | 'all')[] = ['all', 'REQUESTED', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED'];

interface AmdLine { id?: string; salesOrderLineId: string; action: 'CHANGE' | 'ADD' | 'REMOVE'; itemCode: string; description: string; uom: string; oldQty: number | null; oldUnitPriceSen: number | null; newQty: number; newUnitPriceSen: number }
interface Amd { id: string; amendmentNo: string; salesOrderId: string; soDocNo: string; customerName: string; status: Status; reason: string; appliedAt: string; lines?: AmdLine[] }
interface Payload { data: Amd[]; generatedAt: string }
interface SoLine { id: string; itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; deliveredQty: number }
interface OpenSo { id: string; docNo: string; customerName: string; status: string; lines?: SoLine[] }

const FALLBACK: Payload = { generatedAt: '', data: [
  { id: 'a1', amendmentNo: 'AMD-2026-0001', salesOrderId: 'so1', soDocNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', status: 'REQUESTED', reason: 'Customer added a unit', appliedAt: '' },
  { id: 'a2', amendmentNo: 'AMD-2026-0002', salesOrderId: 'so2', soDocNo: 'SO-2026-0004', customerName: 'Arcoris Owner', status: 'APPLIED', reason: 'Price correction', appliedAt: '2026-09-21' },
] };
const SO_FALLBACK: { data: OpenSo[] } = { data: [
  { id: 'so1', docNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', status: 'CONFIRMED', lines: [
    { id: 'sol1', itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qty: 2, unitPriceSen: 328000, deliveredQty: 0 },
    { id: 'sol2', itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qty: 1, unitPriceSen: 189000, deliveredQty: 0 },
  ] },
] };

export default function SalesOrderAmendmentPage() {
  const { data, loading, error, reload } = useApi<Payload>('/so-amendments', FALLBACK);
  const openSos = (useApi<{ data: OpenSo[] }>('/sales-orders', SO_FALLBACK).data?.data ?? []).filter(s => !['CANCELLED', 'CLOSED'].includes(s.status));
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; amd: Amd } | null>(null);
  const [added, setAdded] = useState<Amd[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Amd>>>({});

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(a => ({ ...a, ...edits[a.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(a => (statusFilter === 'all' || a.status === statusFilter) && (!q || `${a.amendmentNo} ${a.soDocNo} ${a.customerName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Amd>[]>(() => [
    { key: 'amendmentNo', label: 'Amendment', type: 'ref', value: a => a.amendmentNo, hideable: false },
    { key: 'so', label: 'Sales order', type: 'ref', value: a => a.soDocNo },
    { key: 'customer', label: 'Customer', value: a => a.customerName },
    { key: 'reason', label: 'Reason', value: a => a.reason, render: a => a.reason ? <span className="text-[12.5px] text-muted-ink">{a.reason}</span> : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: a => a.status, status: a => ({ label: STATUS_LABEL[a.status], tone: STATUS_TONE[a.status] }) },
  ], []);

  function created(a: Amd) { setAdded(x => [a, ...x]); toast({ tone: 'success', title: 'Amendment raised.', body: `${a.amendmentNo} · ${a.soDocNo}` }); setDrawer(null); }
  function act(a: Amd, action: 'approve' | 'reject' | 'cancel' | 'apply', next: Status, label: string) {
    setEdits(e => ({ ...e, [a.id]: { ...e[a.id], status: next } }));
    api.patch(`/so-amendments/${a.id}`, { action }).catch(notifyFailure);
    toast({ tone: 'success', title: label, body: a.amendmentNo });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Sales order amendment" sub={`${all.length} amendments`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New amendment</Button> : undefined} />
      <DataTable<Amd>
        id="scm.so-amendments" columns={columns} rows={data ? rows : null} rowKey={a => a.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={a => setDrawer({ mode: 'view', amd: a })}
        noun={['amendment', 'amendments']} exportName="so-amendments"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search amendment, SO or customer..." aria-label="Search amendments"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No amendments yet.', body: 'Raise an amendment to change a confirmed sales order through a controlled approval.', action: canWrite ? { label: 'New amendment', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />
      {drawer?.mode === 'new' && <NewDrawer openSos={openSos} canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <ViewDrawer amd={drawer.amd} canWrite={canWrite} onClose={() => setDrawer(null)} onAct={act} />}
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

/* ---------- create ---------- */
interface Edit { line: SoLine; newQty: number | null; newPriceSen: number | null; remove: boolean }

function NewDrawer({ openSos, canWrite, onClose, onCreated }: { openSos: OpenSo[]; canWrite: boolean; onClose: () => void; onCreated: (a: Amd) => void }) {
  const [soId, setSoId] = useState('');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<Edit[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const so = openSos.find(s => s.id === soId);

  async function pick(id: string) {
    setSoId(id);
    const s = openSos.find(x => x.id === id);
    let sl = s?.lines;
    if (!sl) { try { const r = await api.get<{ data: { lines: SoLine[] } }>(`/sales-orders/${id}`); sl = r.data.lines; } catch { sl = []; } }
    setRows((sl ?? []).map(l => ({ line: l, newQty: l.qty, newPriceSen: l.unitPriceSen, remove: false })));
  }

  const changed = rows.filter(r => r.remove || r.newQty !== r.line.qty || r.newPriceSen !== r.line.unitPriceSen);
  const canSave = canWrite && soId !== '' && changed.length > 0;
  const qtyError = (r: Edit) => r.remove ? undefined
    : r.newQty == null ? (submitted ? 'Enter a quantity.' : undefined)
    : r.newQty < r.line.deliveredQty ? `At least ${r.line.deliveredQty} (already delivered).` : undefined;
  const priceError = (r: Edit) => !r.remove && submitted && r.newPriceSen == null ? 'Enter a price.' : undefined;

  function submit() {
    setSubmitted(true);
    if (changed.some(r => !r.remove && (r.newQty == null || r.newPriceSen == null || r.newQty < r.line.deliveredQty))) return;
    const lines = changed.map(r => ({
      salesOrderLineId: r.line.id, action: r.remove ? 'REMOVE' : 'CHANGE', itemCode: r.line.itemCode, description: r.line.description, uom: r.line.uom,
      newQty: r.remove ? 0 : r.newQty ?? 0, newUnitPriceSen: r.remove ? r.line.unitPriceSen : r.newPriceSen ?? 0,
    }));
    api.post('/so-amendments', { salesOrderId: soId, reason, lines }).catch(notifyFailure);
    onCreated({ id: `amd-new-${crypto.randomUUID().slice(0, 8)}`, amendmentNo: `AMD-${new Date().getFullYear()}-NEW`, salesOrderId: soId, soDocNo: so?.docNo ?? '', customerName: so?.customerName ?? '', status: 'REQUESTED', reason, appliedAt: '' });
  }

  return (
    <Drawer open onClose={onClose} width={860}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">New amendment</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3.5">
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Sales order</label>
            <select value={soId} onChange={e => void pick(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a sales order…</option>
              {openSos.map(s => <option key={s.id} value={s.id}>{s.docNo} · {s.customerName}</option>)}
            </select>
          </div>
          <Field label="Reason" placeholder="Why this change?" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        {soId && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Line changes</div>
            <div className="overflow-x-auto border border-solid border-line rounded-card">
              <table className="w-full border-collapse min-w-[700px]">
                <thead><tr className="bg-muted">{['Item', 'Current', 'New qty', 'New price (RM)', 'Remove'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : i === 4 ? 'text-center' : 'text-right')}>{th}</th>)}</tr></thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-[12.5px] text-muted-ink">This sales order has no lines.</td></tr>
                  : rows.map((r, i) => (
                    <tr key={r.line.id} className={cx('[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]', r.remove ? 'opacity-55' : '')}>
                      <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{r.line.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{r.line.itemCode}{r.line.deliveredQty > 0 ? ` · ${r.line.deliveredQty} delivered` : ''}</span></div></td>
                      <td className="py-2 px-3 text-right tabular-nums text-[12.5px] text-muted-ink">{r.line.qty} × {rm(r.line.unitPriceSen)}</td>
                      <td className="py-2 px-3 text-right"><NumberInput aria-label={`New quantity for ${r.line.itemCode}`} min={0} disabled={r.remove} value={r.newQty} error={qtyError(r)} onChange={v => setRows(rs => rs.map((x, j) => j === i ? { ...x, newQty: v } : x))} className="h-8 w-[72px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-50" /></td>
                      <td className="py-2 px-3 text-right"><MoneyInput aria-label={`New price for ${r.line.itemCode} (RM)`} disabled={r.remove} valueSen={r.newPriceSen} error={priceError(r)} onChangeSen={v => setRows(rs => rs.map((x, j) => j === i ? { ...x, newPriceSen: v } : x))} className="h-8 w-[96px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-50" /></td>
                      <td className="py-2 px-3 text-center"><input type="checkbox" checked={r.remove} disabled={r.line.deliveredQty > 0} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, remove: e.target.checked } : x))} className="w-4 h-4 accent-black cursor-pointer disabled:opacity-40" title={r.line.deliveredQty > 0 ? 'Delivered lines cannot be removed' : 'Remove this line'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[12px] text-muted-ink">{changed.length} line{changed.length === 1 ? '' : 's'} changed. New quantities cannot drop below delivered.</div>
          </div>
        )}
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick an SO and change at least one line" onClick={submit}>Request amendment</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view ---------- */
const lineColumns: Column<AmdLine>[] = [
  { key: 'item', label: 'Item', value: l => l.description, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)]">{l.itemCode}</span>, text: l => `${l.description} ${l.itemCode}` },
  { key: 'action', label: 'Change', value: l => l.action, filter: false, render: l => <span className={cx('text-[12px] font-semibold', l.action === 'REMOVE' ? TONE.critical.text : l.action === 'ADD' ? TONE.success.text : TONE.info.text)}>{l.action}</span> },
  { key: 'from', label: 'From', align: 'right', sortable: false, filter: false, value: l => l.oldQty != null ? `${l.oldQty} × ${rm(l.oldUnitPriceSen ?? 0)}` : null, render: l => <span className="tabular-nums text-[12.5px] text-muted-ink">{l.oldQty != null ? `${l.oldQty} × ${rm(l.oldUnitPriceSen ?? 0)}` : '—'}</span> },
  { key: 'to', label: 'To', align: 'right', sortable: false, filter: false, value: l => l.action === 'REMOVE' ? null : `${l.newQty} × ${rm(l.newUnitPriceSen)}`, render: l => <span className="tabular-nums text-[12.5px]">{l.action === 'REMOVE' ? '—' : `${l.newQty} × ${rm(l.newUnitPriceSen)}`}</span> },
];

function ViewDrawer({ amd, canWrite, onClose, onAct }: { amd: Amd; canWrite: boolean; onClose: () => void; onAct: (a: Amd, action: 'approve' | 'reject' | 'cancel' | 'apply', next: Status, label: string) => void }) {
  const { data } = useApi<{ data: Amd }>(`/so-amendments/${amd.id}`, { data: { ...amd, lines: amd.lines ?? [] } });
  const full = data?.data ?? amd;
  const lineRows = useMemo(() => (full.lines ?? []).map((l, i) => ({ ...l, key: l.id ?? String(i) })), [full.lines]);
  return (
    <Drawer open onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{full.amendmentNo}</h2><StatusPill status={full.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Sales order" value={full.soDocNo} mono />
          <Meta label="Customer" value={full.customerName} />
          <Meta label="Applied" value={full.appliedAt ? date(full.appliedAt) : '—'} />
          <Meta label="Reason" value={full.reason || '—'} />
        </div>
        <div className="border border-solid border-line rounded-card overflow-hidden">
          <DataTable<AmdLine & { key: string }>
            id="scm.so-amendment.lines" urlPrefix="lines." bare noViews noToolbar pageSize={0}
            columns={lineColumns} rows={lineRows} rowKey={l => l.key}
            noun={['line change', 'line changes']} exportName={`${full.amendmentNo}-lines`}
            empty={{ title: 'No line changes recorded.' }} />
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{canWrite && (full.status === 'REQUESTED' || full.status === 'APPROVED') && <Button size="sm" variant="danger" onClick={() => onAct(full, 'reject', 'REJECTED', 'Amendment rejected.')}>Reject</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {canWrite && full.status === 'REQUESTED' && <Button size="sm" variant="secondary" onClick={() => onAct(full, 'approve', 'APPROVED', 'Amendment approved.')}>Approve</Button>}
          {canWrite && full.status === 'APPROVED' && <Button size="sm" variant="primary" onClick={() => onAct(full, 'apply', 'APPLIED', 'Amendment applied to the SO.')}>Apply to SO</Button>}
        </div>
      </div>
    </Drawer>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className={cx('text-[13.5px]', mono ? '[font-family:var(--font-mono,ui-monospace,monospace)]' : '')}>{value}</span></div>;
}
