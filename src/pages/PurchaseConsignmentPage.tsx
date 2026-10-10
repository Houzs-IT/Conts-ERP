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
import { rm } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/** Purchase Consignment Orders — ported from 2990's SCM, drawn in Conts. A PO for consigned
 *  stock (settle only what's used; return the unsold). Receives/returns = a later slice. */

type Status = 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
const STATUS_LABEL: Record<Status, string> = { SUBMITTED: 'Submitted', PARTIALLY_RECEIVED: 'Partly received', RECEIVED: 'Received', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, Tone> = { SUBMITTED: 'info', PARTIALLY_RECEIVED: 'warning', RECEIVED: 'success', CANCELLED: 'neutral' };
const FILTERS: (Status | 'all')[] = ['all', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

interface Line { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; discountSen: number; lineTotalSen: number }
interface Pc { id: string; pcNumber: string; supplierId: string; supplierCode: string; supplierName: string; status: Status; pcDate: string; expectedAt: string; warehouseId: string; subtotalSen: number; taxSen: number; totalSen: number; notes: string; lines?: Line[] }
interface Payload { data: Pc[]; generatedAt: string }
interface Opt { id: string; code: string; name: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'pc1', pcNumber: 'PC-2026-0001', supplierId: 's1', supplierCode: 'SUP-EMMA', supplierName: 'Emma Furnishings Sdn Bhd', status: 'SUBMITTED', pcDate: '2026-09-18', expectedAt: '2026-10-05', warehouseId: 'w1', subtotalSen: 656000, taxSen: 0, totalSen: 656000, notes: 'Showroom consignment stock.', lines: [
      { itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qty: 2, unitPriceSen: 328000, discountSen: 0, lineTotalSen: 656000 },
    ] },
  ],
};
const SUP_FALLBACK = { data: [{ id: 's1', code: 'SUP-EMMA', name: 'Emma Furnishings Sdn Bhd' }, { id: 's3', code: 'SUP-NORDIC', name: 'Nordic Woodcraft' }] };
const WH_FALLBACK = { data: [{ id: 'w1', code: 'WH-MAIN', name: 'Main Warehouse' }] };

const senToRm = (sen: number) => (sen ? String(sen / 100) : '');
const rmToSen = (v: string) => { const n = Number(v); return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : 0; };

export default function PurchaseConsignmentPage() {
  const { data, loading, error, reload } = useApi<Payload>('/purchase-consignment', FALLBACK);
  const suppliers = useApi<{ data: Opt[] }>('/suppliers', SUP_FALLBACK).data?.data ?? [];
  const warehouses = useApi<{ data: Opt[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<Pc | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [added, setAdded] = useState<Pc[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Pc>>>({});

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.pcNumber} ${p.supplierName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Pc>[]>(() => [
    { key: 'pcNumber', label: 'PC number', type: 'ref', value: p => p.pcNumber, hideable: false },
    { key: 'supplier', label: 'Supplier', value: p => p.supplierName, sub: p => p.supplierCode, text: p => `${p.supplierName} ${p.supplierCode}` },
    { key: 'pcDate', label: 'PC date', type: 'date', value: p => p.pcDate || null },
    { key: 'expectedAt', label: 'Expected', type: 'date', value: p => p.expectedAt || null },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, status: p => ({ label: STATUS_LABEL[p.status], tone: STATUS_TONE[p.status] }) },
    { key: 'total', label: 'Total', type: 'money', value: p => p.totalSen },
  ], []);

  function openNew() { setIsNew(true); setDrawer({ id: '', pcNumber: '', supplierId: suppliers[0]?.id ?? '', supplierCode: '', supplierName: '', status: 'SUBMITTED', pcDate: new Date().toISOString().slice(0, 10), expectedAt: '', warehouseId: warehouses[0]?.id ?? '', subtotalSen: 0, taxSen: 0, totalSen: 0, notes: '', lines: [] }); }
  function totalsOf(lines: Line[], taxSen: number) { const subtotalSen = lines.reduce((s, l) => s + l.lineTotalSen, 0); return { subtotalSen, taxSen: Math.max(0, taxSen), totalSen: subtotalSen + Math.max(0, taxSen) }; }
  function body(pc: Pc, lines: Line[]) { return { supplierId: pc.supplierId, pcDate: pc.pcDate, expectedAt: pc.expectedAt || null, warehouseId: pc.warehouseId || null, notes: pc.notes, taxSen: pc.taxSen, lines: lines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen, discountSen: l.discountSen })) }; }

  function save(pc: Pc, lines: Line[]) {
    const supplier = suppliers.find(s => s.id === pc.supplierId);
    if (isNew) {
      setAdded(a => [{ ...pc, id: `pc-new-${crypto.randomUUID().slice(0, 8)}`, pcNumber: `PC-${new Date().getFullYear()}-NEW`, supplierCode: supplier?.code ?? '', supplierName: supplier?.name ?? '', lines }, ...a]);
      api.post('/purchase-consignment', body(pc, lines)).catch(notifyFailure);
      toast({ tone: 'success', title: 'Consignment order raised.', body: supplier?.name ?? '' });
    } else {
      setEdits(e => ({ ...e, [pc.id]: { ...e[pc.id], ...totalsOf(lines, pc.taxSen), supplierId: pc.supplierId, supplierCode: supplier?.code ?? pc.supplierCode, supplierName: supplier?.name ?? pc.supplierName, expectedAt: pc.expectedAt, warehouseId: pc.warehouseId, notes: pc.notes, pcDate: pc.pcDate, lines } }));
      api.patch(`/purchase-consignment/${pc.id}`, body(pc, lines)).catch(notifyFailure);
      toast({ tone: 'success', title: 'Consignment order updated.', body: pc.pcNumber });
    }
    setDrawer(null);
  }
  function cancelPc(p: Pc) { setEdits(e => ({ ...e, [p.id]: { ...e[p.id], status: 'CANCELLED' } })); api.patch(`/purchase-consignment/${p.id}`, { status: 'CANCELLED' }).catch(notifyFailure); toast({ tone: 'success', title: 'Consignment order cancelled.', body: p.pcNumber }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Consignment orders" sub={`${all.length} orders · consigned stock`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={openNew}>New consignment</Button> : undefined} />
      <DataTable<Pc>
        id="scm.purchase-consignment" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => { setIsNew(false); setDrawer({ ...p, lines: p.lines ?? [] }); }}
        noun={['consignment order', 'consignment orders']} exportName="consignment-orders"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PC or supplier..." aria-label="Search consignment orders"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[260px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No consignment orders yet.', body: 'Raise a consignment order for stock you settle only when used.', action: canWrite ? { label: 'New consignment', onClick: openNew } : undefined }} />
      {drawer && <PcDrawer pc={drawer} isNew={isNew} suppliers={suppliers} warehouses={warehouses} canWrite={canWrite}
        onClose={() => setDrawer(null)} onSave={save} onCancelPc={cancelPc} totalsOf={totalsOf} />}
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

interface DraftLine { itemCode: string; description: string; uom: string; qty: string; unitPrice: string; discount: string }
const toDraftLine = (l: Line): DraftLine => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: String(l.qty), unitPrice: senToRm(l.unitPriceSen), discount: senToRm(l.discountSen) });
const blankLine = (): DraftLine => ({ itemCode: '', description: '', uom: 'UNIT', qty: '1', unitPrice: '', discount: '' });
const lineTotal = (l: DraftLine) => Math.max(0, (Number(l.qty) || 0) * rmToSen(l.unitPrice) - rmToSen(l.discount));

function PcDrawer({ pc, isNew, suppliers, warehouses, canWrite, onClose, onSave, onCancelPc, totalsOf }: {
  pc: Pc; isNew: boolean; suppliers: Opt[]; warehouses: Opt[]; canWrite: boolean; onClose: () => void; onSave: (p: Pc, l: Line[]) => void; onCancelPc: (p: Pc) => void; totalsOf: (l: Line[], t: number) => { subtotalSen: number; taxSen: number; totalSen: number };
}) {
  const editable = canWrite && (isNew || pc.status === 'SUBMITTED');
  const [h, setH] = useState<Pc>(pc);
  const [lines, setLines] = useState<DraftLine[]>((pc.lines ?? []).map(toDraftLine));
  const setHf = <K extends keyof Pc>(k: K) => (e: { target: { value: string } }) => setH(s => ({ ...s, [k]: e.target.value as Pc[K] }));
  const setLine = (i: number, k: keyof DraftLine, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = subtotal + Math.max(0, h.taxSen);
  const built = (): Line[] => lines.filter(l => l.itemCode.trim() && l.description.trim()).map(l => ({ itemCode: l.itemCode.trim(), description: l.description.trim(), uom: l.uom.trim() || 'UNIT', qty: Number(l.qty) || 0, unitPriceSen: rmToSen(l.unitPrice), discountSen: rmToSen(l.discount), lineTotalSen: lineTotal(l) }));
  const canSave = h.supplierId !== '' && built().length > 0;

  return (
    <Drawer open onClose={onClose} width={880}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New consignment order' : pc.pcNumber}</h2>{!isNew && <StatusPill status={pc.status} />}</div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Supplier</label>
            <select value={h.supplierId} disabled={!editable} onChange={setHf('supplierId')} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-70">
              {suppliers.length === 0 && <option value="">No suppliers</option>}
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Field label="PC date" type="date" value={h.pcDate} onChange={setHf('pcDate')} disabled={!editable} />
          <Field label="Expected" type="date" value={h.expectedAt} onChange={setHf('expectedAt')} disabled={!editable} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
            <select value={h.warehouseId} disabled={!editable} onChange={setHf('warehouseId')} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-70">
              <option value="">—</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines</div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[720px]">
              <thead><tr className="bg-muted">{['Item code', 'Description', 'UOM', 'Qty', 'Unit price', 'Discount', 'Line total', ''].map((th, i) => <th key={th || i} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i >= 3 && i <= 6 ? 'text-right' : 'text-left')}>{th}</th>)}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="p-1.5"><Cell value={l.itemCode} onChange={v => setLine(i, 'itemCode', v)} disabled={!editable} w="130px" /></td>
                    <td className="p-1.5"><Cell value={l.description} onChange={v => setLine(i, 'description', v)} disabled={!editable} w="100%" /></td>
                    <td className="p-1.5"><Cell value={l.uom} onChange={v => setLine(i, 'uom', v)} disabled={!editable} w="70px" /></td>
                    <td className="p-1.5"><Cell value={l.qty} onChange={v => setLine(i, 'qty', v)} disabled={!editable} w="64px" right num /></td>
                    <td className="p-1.5"><Cell value={l.unitPrice} onChange={v => setLine(i, 'unitPrice', v)} disabled={!editable} w="96px" right num /></td>
                    <td className="p-1.5"><Cell value={l.discount} onChange={v => setLine(i, 'discount', v)} disabled={!editable} w="90px" right num /></td>
                    <td className="p-1.5 text-right tabular-nums text-[13px] whitespace-nowrap">{rm(lineTotal(l))}</td>
                    <td className="p-1.5 text-center">{editable && <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line" className="text-muted-ink hover:text-[var(--color-critical-fg)] bg-transparent border-none cursor-pointer p-1"><Trash2 size={15} /></button>}</td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[12.5px] text-muted-ink">No lines yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {editable && <div><Button size="sm" variant="secondary" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setLines(ls => [...ls, blankLine()])}>Add line</Button></div>}
        </div>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={h.notes} onChange={setHf('notes')} disabled={!editable} />
          <div className="flex flex-col gap-1.5 items-end justify-end">
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Subtotal</span><span className="tabular-nums w-[110px] text-right">{rm(subtotal)}</span></div>
            <div className="flex gap-8 text-[13px] items-center"><span className="text-muted-ink">Tax</span><input type="number" step="0.01" disabled={!editable} value={senToRm(h.taxSen)} onChange={e => setH(s => ({ ...s, taxSen: rmToSen(e.target.value) }))} className="h-8 w-[110px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70" /></div>
            <div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[110px] text-right">{rm(total)}</span></div>
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{!isNew && canWrite && pc.status !== 'CANCELLED' && pc.status !== 'RECEIVED' && <Button size="sm" variant="danger" onClick={() => onCancelPc(pc)}>Cancel order</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {editable && <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a supplier and add at least one line" onClick={() => { const l = built(); onSave({ ...h, ...totalsOf(l, h.taxSen) }, l); }}>{isNew ? 'Raise order' : 'Save'}</Button>}
        </div>
      </div>
    </Drawer>
  );
}

function Cell({ value, onChange, disabled, w, right, num }: { value: string; onChange: (v: string) => void; disabled?: boolean; w: string; right?: boolean; num?: boolean }) {
  return <input value={value} disabled={disabled} type={num ? 'number' : 'text'} step={num ? '0.01' : undefined} onChange={e => onChange(e.target.value)} style={{ width: w }}
    className={cx('h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70 disabled:bg-transparent disabled:border-transparent', right ? 'text-right tabular-nums' : '')} />;
}
