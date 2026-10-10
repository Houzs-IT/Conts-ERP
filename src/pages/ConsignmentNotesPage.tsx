import { useMemo, useState } from 'react';
import { Search, Plus, Trash2, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/** Consignment Notes (sell-side) — ported from 2990's SCM, drawn in Conts. Consign stock out
 *  to a consignee; track consigned / sold / returned per line. */

type Status = 'OPEN' | 'PARTIALLY_SETTLED' | 'CLOSED' | 'CANCELLED';
const STATUS_LABEL: Record<Status, string> = { OPEN: 'Open', PARTIALLY_SETTLED: 'Part settled', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, Tone> = { OPEN: 'info', PARTIALLY_SETTLED: 'warning', CLOSED: 'success', CANCELLED: 'neutral' };
const FILTERS: (Status | 'all')[] = ['all', 'OPEN', 'PARTIALLY_SETTLED', 'CLOSED', 'CANCELLED'];

interface Line { id?: string; itemCode: string; description: string; uom: string; qtyConsigned: number; qtySold: number; qtyReturned: number; unitPriceSen: number; lineTotalSen: number }
interface Cn { id: string; cnNumber: string; consigneeName: string; consigneePhone: string; cnDate: string; status: Status; totalSen: number; notes: string; lines?: Line[] }
interface Payload { data: Cn[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'cn1', cnNumber: 'CN-2026-0001', consigneeName: 'Mont Kiara Showroom', consigneePhone: '+60312340000', cnDate: '2026-09-14', status: 'PARTIALLY_SETTLED', totalSen: 984000, notes: 'Display consignment.', lines: [
      { id: 'cl1', itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qtyConsigned: 2, qtySold: 1, qtyReturned: 0, unitPriceSen: 328000, lineTotalSen: 656000 },
      { id: 'cl2', itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak', uom: 'UNIT', qtyConsigned: 2, qtySold: 0, qtyReturned: 0, unitPriceSen: 164000, lineTotalSen: 328000 },
    ] },
  ],
};

const rmToSen = (v: string) => { const n = Number(v); return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : 0; };

export default function ConsignmentNotesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/consignment-notes', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; cn: Cn } | null>(null);
  const [added, setAdded] = useState<Cn[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Cn>>>({});

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(c => ({ ...c, ...edits[c.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(c => (statusFilter === 'all' || c.status === statusFilter) && (!q || `${c.cnNumber} ${c.consigneeName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Cn>[]>(() => [
    { key: 'cnNumber', label: 'CN number', type: 'ref', value: c => c.cnNumber, hideable: false },
    { key: 'consignee', label: 'Consignee', value: c => c.consigneeName },
    { key: 'cnDate', label: 'Date', type: 'date', value: c => c.cnDate || null },
    { key: 'status', label: 'Status', type: 'status', value: c => c.status, status: c => ({ label: STATUS_LABEL[c.status], tone: STATUS_TONE[c.status] }) },
    { key: 'value', label: 'Value', type: 'money', value: c => c.totalSen, render: c => <span className="tabular-nums font-semibold">{rm(c.totalSen)}</span> },
  ], []);

  function created(cn: Cn) { setAdded(a => [cn, ...a]); toast({ tone: 'success', title: 'Consignment note raised.', body: `${cn.cnNumber} · ${cn.consigneeName}` }); setDrawer(null); }
  function act(cn: Cn, patch: Record<string, unknown>, optimistic: Partial<Cn>, title: string) {
    setEdits(e => ({ ...e, [cn.id]: { ...e[cn.id], ...optimistic } }));
    api.patch(`/consignment-notes/${cn.id}`, patch).catch(notifyFailure);
    toast({ tone: 'success', title, body: cn.cnNumber });
    setDrawer(d => d && d.mode === 'view' ? { mode: 'view', cn: { ...d.cn, ...optimistic } } : d);
  }

  return (
    <>
      <PageHeader title="Consignment notes" sub={`${all.length} notes · stock consigned out`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New consignment note</Button> : undefined} />
      <DataTable<Cn>
        id="scm.consignment-notes" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={c => setDrawer({ mode: 'view', cn: c })}
        noun={['consignment note', 'consignment notes']} exportName="consignment-notes"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search note or consignee..." aria-label="Search consignment notes"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No consignment notes yet.', body: 'Consign stock out to a showroom or retailer.', action: canWrite ? { label: 'New consignment note', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />
      {drawer?.mode === 'new' && <CreateDrawer canWrite={canWrite} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'view' && <SettleDrawer cn={drawer.cn} canWrite={canWrite} onClose={() => setDrawer(null)} onAct={act} />}
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

interface DraftLine { itemCode: string; description: string; uom: string; qty: string; unitPrice: string }
const blankLine = (): DraftLine => ({ itemCode: '', description: '', uom: 'UNIT', qty: '1', unitPrice: '' });
const lineTotal = (l: DraftLine) => Math.max(0, (Number(l.qty) || 0) * rmToSen(l.unitPrice));

function CreateDrawer({ canWrite, onClose, onCreated }: { canWrite: boolean; onClose: () => void; onCreated: (c: Cn) => void }) {
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneePhone, setConsigneePhone] = useState('');
  const [cnDate, setCnDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const setLine = (i: number, k: keyof DraftLine, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const built = () => lines.filter(l => l.itemCode.trim() && l.description.trim() && (Number(l.qty) || 0) > 0).map(l => ({ itemCode: l.itemCode.trim(), description: l.description.trim(), uom: l.uom.trim() || 'UNIT', qtyConsigned: Number(l.qty) || 0, unitPriceSen: rmToSen(l.unitPrice) }));
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const canSave = canWrite && consigneeName.trim() !== '' && built().length > 0;

  function submit() {
    const b = built();
    api.post('/consignment-notes', { consigneeName, consigneePhone, cnDate, notes, lines: b }).catch(notifyFailure);
    onCreated({ id: `cn-new-${crypto.randomUUID().slice(0, 8)}`, cnNumber: `CN-${new Date().getFullYear()}-NEW`, consigneeName, consigneePhone, cnDate, status: 'OPEN', totalSen: total, notes,
      lines: b.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qtyConsigned: l.qtyConsigned, qtySold: 0, qtyReturned: 0, unitPriceSen: l.unitPriceSen, lineTotalSen: l.qtyConsigned * l.unitPriceSen })) });
  }

  return (
    <Drawer open onClose={onClose} width={820}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New consignment note</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
          <Field label="Consignee" placeholder="Showroom / retailer" value={consigneeName} onChange={e => setConsigneeName(e.target.value)} />
          <Field label="Phone" value={consigneePhone} onChange={e => setConsigneePhone(e.target.value)} />
          <Field label="Date" type="date" value={cnDate} onChange={e => setCnDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines to consign</div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[640px]">
              <thead><tr className="bg-muted">{['Item code', 'Description', 'UOM', 'Qty', 'Unit price', 'Line total', ''].map((th, i) => <th key={th || i} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i >= 3 && i <= 5 ? 'text-right' : 'text-left')}>{th}</th>)}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="p-1.5"><Cell value={l.itemCode} onChange={v => setLine(i, 'itemCode', v)} w="130px" /></td>
                    <td className="p-1.5"><Cell value={l.description} onChange={v => setLine(i, 'description', v)} w="100%" /></td>
                    <td className="p-1.5"><Cell value={l.uom} onChange={v => setLine(i, 'uom', v)} w="70px" /></td>
                    <td className="p-1.5"><Cell value={l.qty} onChange={v => setLine(i, 'qty', v)} w="64px" right num /></td>
                    <td className="p-1.5"><Cell value={l.unitPrice} onChange={v => setLine(i, 'unitPrice', v)} w="96px" right num /></td>
                    <td className="p-1.5 text-right tabular-nums text-[13px] whitespace-nowrap">{rm(lineTotal(l))}</td>
                    <td className="p-1.5 text-center"><button onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} aria-label="Remove line" className="text-muted-ink hover:text-[var(--color-critical-fg)] bg-transparent border-none cursor-pointer p-1"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><Button size="sm" variant="secondary" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setLines(ls => [...ls, blankLine()])}>Add line</Button></div>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex items-end justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Consigned value</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div></div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a consignee and at least one line" onClick={submit}>Raise note</Button>
      </div>
    </Drawer>
  );
}

function SettleDrawer({ cn, canWrite, onClose, onAct }: { cn: Cn; canWrite: boolean; onClose: () => void; onAct: (c: Cn, patch: Record<string, unknown>, optimistic: Partial<Cn>, title: string) => void }) {
  const editable = canWrite && (cn.status === 'OPEN' || cn.status === 'PARTIALLY_SETTLED');
  const [lines, setLines] = useState<Line[]>((cn.lines ?? []).map(l => ({ ...l })));
  const setLine = (i: number, k: 'qtySold' | 'qtyReturned', v: number) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: Math.max(0, Math.min(l.qtyConsigned, v)) } : l));

  function saveSettlement() {
    onAct(cn, { lines: lines.map(l => ({ id: l.id, qtySold: l.qtySold, qtyReturned: l.qtyReturned })) }, { lines }, 'Settlement saved.');
  }

  return (
    <Drawer open onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{cn.cnNumber}</h2><StatusPill status={cn.status} /></div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-[13px]">
          <Meta label="Consignee" value={cn.consigneeName} />
          <Meta label="Phone" value={cn.consigneePhone || '—'} />
          <Meta label="Date" value={cn.cnDate ? date(cn.cnDate) : '—'} />
        </div>
        <div className="overflow-x-auto border border-solid border-line rounded-card">
          <table className="w-full border-collapse min-w-[560px]">
            <thead><tr className="bg-muted">{['Item', 'Consigned', 'Sold', 'Returned'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>)}</tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id ?? i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.qtyConsigned}</td>
                  <td className="py-2 px-3 text-right">{editable ? <NumCell value={l.qtySold} onChange={v => setLine(i, 'qtySold', v)} /> : <span className="tabular-nums text-[13px]">{l.qtySold}</span>}</td>
                  <td className="py-2 px-3 text-right">{editable ? <NumCell value={l.qtyReturned} onChange={v => setLine(i, 'qtyReturned', v)} /> : <span className="tabular-nums text-[13px]">{l.qtyReturned}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cn.notes && <div className="text-[13px]"><span className="text-muted-ink">Notes: </span>{cn.notes}</div>}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{canWrite && cn.status !== 'CANCELLED' && cn.status !== 'CLOSED' && <Button size="sm" variant="danger" onClick={() => onAct(cn, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Note cancelled.')}>Cancel</Button>}</div>
        <div className="flex gap-2.5">
          {canWrite && cn.status !== 'CANCELLED' && cn.status !== 'CLOSED' && <Button size="sm" variant="secondary" onClick={() => onAct(cn, { status: 'CLOSED' }, { status: 'CLOSED' }, 'Note closed.')}>Close</Button>}
          {editable && <Button size="sm" variant="primary" onClick={saveSettlement}>Save settlement</Button>}
          <Button size="sm" variant="secondary" onClick={onClose}>Close panel</Button>
        </div>
      </div>
    </Drawer>
  );
}

function Cell({ value, onChange, w, right, num }: { value: string; onChange: (v: string) => void; w: string; right?: boolean; num?: boolean }) {
  return <input value={value} type={num ? 'number' : 'text'} step={num ? '0.01' : undefined} onChange={e => onChange(e.target.value)} style={{ width: w }}
    className={cx('h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none', right ? 'text-right tabular-nums' : '')} />;
}
function NumCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="number" min={0} value={String(value)} onChange={e => onChange(Math.round(Number(e.target.value) || 0))} className="h-8 w-[70px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />;
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className="text-[13.5px]">{value}</span></div>;
}
