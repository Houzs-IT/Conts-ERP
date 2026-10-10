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

/** Sales Orders — ported from 2990's SCM (core sell-side doc), drawn in Conts. Header +
 *  lines + 9-state status flow + deposit/payment. Customer inline; DO/SI are next modules. */

type Status = 'CONFIRMED' | 'IN_PRODUCTION' | 'READY_TO_SHIP' | 'SHIPPED' | 'DELIVERED' | 'INVOICED' | 'CLOSED' | 'ON_HOLD' | 'CANCELLED';
const STATUS_LABEL: Record<Status, string> = { CONFIRMED: 'Confirmed', IN_PRODUCTION: 'In production', READY_TO_SHIP: 'Ready to ship', SHIPPED: 'Shipped', DELIVERED: 'Delivered', INVOICED: 'Invoiced', CLOSED: 'Closed', ON_HOLD: 'On hold', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, Tone> = { CONFIRMED: 'info', IN_PRODUCTION: 'warning', READY_TO_SHIP: 'info', SHIPPED: 'info', DELIVERED: 'success', INVOICED: 'success', CLOSED: 'neutral', ON_HOLD: 'warning', CANCELLED: 'critical' };
const FLOW: Status[] = ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED'];
const FILTERS: (Status | 'all')[] = ['all', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'DELIVERED', 'INVOICED', 'ON_HOLD', 'CANCELLED'];

interface Line { itemCode: string; description: string; uom: string; qty: number; unitPriceSen: number; discountSen: number; lineTotalSen: number; deliveredQty?: number }
interface So { id: string; docNo: string; customerName: string; customerPhone: string; customerPo: string; soDate: string; targetDate: string; status: Status; subtotalSen: number; taxSen: number; totalSen: number; depositSen: number; paidSen: number; outstandingSen: number; notes: string; lines?: Line[] }
interface Payload { data: So[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'so1', docNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', customerPhone: '+60312223344', customerPo: 'VJ-PO-88', soDate: '2026-09-16', targetDate: '2026-10-10', status: 'IN_PRODUCTION', subtotalSen: 984000, taxSen: 0, totalSen: 984000, depositSen: 300000, paidSen: 300000, outstandingSen: 684000, notes: 'Show unit furnishing.', lines: [
      { itemCode: 'SF-3S-GRY', description: 'Emma 3-Seater Sofa', uom: 'UNIT', qty: 2, unitPriceSen: 328000, discountSen: 0, lineTotalSen: 656000 },
      { itemCode: 'BF-KG-OAK', description: 'Nordic Bedframe, Oak, King', uom: 'UNIT', qty: 1, unitPriceSen: 189000, discountSen: 0, lineTotalSen: 189000 },
      { itemCode: 'MT-KG-HIL', description: 'Hilton Mattress, King', uom: 'UNIT', qty: 1, unitPriceSen: 139000, discountSen: 0, lineTotalSen: 139000 },
    ] },
    { id: 'so2', docNo: 'SO-2026-0002', customerName: 'Arcoris Owner', customerPhone: '+60198887766', customerPo: '', soDate: '2026-09-12', targetDate: '2026-09-30', status: 'DELIVERED', subtotalSen: 420000, taxSen: 0, totalSen: 420000, depositSen: 420000, paidSen: 420000, outstandingSen: 0, notes: '', lines: [{ itemCode: 'MT-KG-HIL', description: 'Hilton Mattress, King', uom: 'UNIT', qty: 1, unitPriceSen: 420000, discountSen: 0, lineTotalSen: 420000 }] },
  ],
};

const senToRm = (sen: number) => (sen ? String(sen / 100) : '');
const rmToSen = (v: string) => { const n = Number(v); return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : 0; };

export default function SalesOrdersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/sales-orders', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<So | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [added, setAdded] = useState<So[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<So>>>({});

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.docNo} ${p.customerName} ${p.customerPo}`.toLowerCase().includes(q)));
  const outstanding = all.filter(p => p.status !== 'CANCELLED').reduce((s, p) => s + p.outstandingSen, 0);

  const columns = useMemo<Column<So>[]>(() => [
    { key: 'docNo', label: 'SO number', type: 'ref', value: p => p.docNo, hideable: false },
    { key: 'customer', label: 'Customer', value: p => p.customerName, sub: p => p.customerPo ? `PO ${p.customerPo}` : null, text: p => `${p.customerName} ${p.customerPo}`.trim() },
    { key: 'soDate', label: 'SO date', type: 'date', value: p => p.soDate || null },
    { key: 'target', label: 'Target', type: 'date', value: p => p.targetDate || null },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, status: p => ({ label: STATUS_LABEL[p.status], tone: STATUS_TONE[p.status] }) },
    { key: 'total', label: 'Total', type: 'money', value: p => p.totalSen },
    { key: 'outstanding', label: 'Outstanding', type: 'money', value: p => p.status === 'CANCELLED' ? null : p.outstandingSen, render: p => p.status === 'CANCELLED' ? <span className="text-muted-ink">—</span> : <span className="tabular-nums font-semibold">{rm(p.outstandingSen)}</span> },
  ], []);

  function totalsOf(lines: Line[], taxSen: number) { const subtotalSen = lines.reduce((s, l) => s + l.lineTotalSen, 0); return { subtotalSen, taxSen: Math.max(0, taxSen), totalSen: subtotalSen + Math.max(0, taxSen) }; }
  function body(so: So, lines: Line[]) { return { customerName: so.customerName, customerPhone: so.customerPhone, customerPo: so.customerPo, soDate: so.soDate, targetDate: so.targetDate || null, notes: so.notes, taxSen: so.taxSen, depositSen: so.depositSen, lines: lines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen, discountSen: l.discountSen })) }; }

  function openNew() { setIsNew(true); setDrawer({ id: '', docNo: '', customerName: '', customerPhone: '', customerPo: '', soDate: new Date().toISOString().slice(0, 10), targetDate: '', status: 'CONFIRMED', subtotalSen: 0, taxSen: 0, totalSen: 0, depositSen: 0, paidSen: 0, outstandingSen: 0, notes: '', lines: [] }); }
  function save(so: So, lines: Line[]) {
    const t = totalsOf(lines, so.taxSen);
    if (isNew) {
      setAdded(a => [{ ...so, ...t, id: `so-new-${crypto.randomUUID().slice(0, 8)}`, docNo: `SO-${new Date().getFullYear()}-NEW`, outstandingSen: t.totalSen - so.paidSen, lines }, ...a]);
      api.post('/sales-orders', body(so, lines)).catch(notifyFailure);
      toast({ tone: 'success', title: 'Sales order raised.', body: so.customerName });
    } else {
      setEdits(e => ({ ...e, [so.id]: { ...e[so.id], ...t, customerName: so.customerName, customerPhone: so.customerPhone, customerPo: so.customerPo, soDate: so.soDate, targetDate: so.targetDate, depositSen: so.depositSen, notes: so.notes, outstandingSen: t.totalSen - so.paidSen, lines } }));
      api.patch(`/sales-orders/${so.id}`, body(so, lines)).catch(notifyFailure);
      toast({ tone: 'success', title: 'Sales order updated.', body: so.docNo });
    }
    setDrawer(null);
  }
  function act(so: So, patch: Record<string, unknown>, optimistic: Partial<So>, title: string) {
    setEdits(e => ({ ...e, [so.id]: { ...e[so.id], ...optimistic } }));
    api.patch(`/sales-orders/${so.id}`, patch).catch(notifyFailure);
    toast({ tone: 'success', title, body: so.docNo });
    setDrawer(d => d ? { ...d, ...optimistic } : d);
  }

  return (
    <>
      <PageHeader title="Sales orders" sub={`${all.length} orders · ${rm(outstanding, { cents: false })} outstanding`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={openNew}>New sales order</Button> : undefined} />
      <DataTable<So>
        id="scm.sales-orders" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => { setIsNew(false); setDrawer({ ...p, lines: p.lines ?? [] }); }}
        noun={['sales order', 'sales orders']} exportName="sales-orders"
        toolbar={<>
          <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SO or customer..." aria-label="Search sales orders"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[260px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No sales orders yet.', body: 'Raise a sales order for a customer.', action: canWrite ? { label: 'New sales order', onClick: openNew } : undefined }} />
      {drawer && <SoDrawer so={drawer} isNew={isNew} canWrite={canWrite} onClose={() => setDrawer(null)} onSave={save} onAct={act} totalsOf={totalsOf} />}
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

function SoDrawer({ so, isNew, canWrite, onClose, onSave, onAct, totalsOf }: {
  so: So; isNew: boolean; canWrite: boolean; onClose: () => void; onSave: (s: So, l: Line[]) => void;
  onAct: (s: So, patch: Record<string, unknown>, optimistic: Partial<So>, title: string) => void; totalsOf: (l: Line[], t: number) => { subtotalSen: number; taxSen: number; totalSen: number };
}) {
  const editable = canWrite && (isNew || so.status === 'CONFIRMED');
  const [h, setH] = useState<So>(so);
  const [lines, setLines] = useState<DraftLine[]>((so.lines ?? []).map(toDraftLine));
  const [pay, setPay] = useState('');
  const setHf = <K extends keyof So>(k: K) => (e: { target: { value: string } }) => setH(s => ({ ...s, [k]: e.target.value as So[K] }));
  const setLine = (i: number, k: keyof DraftLine, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = subtotal + Math.max(0, h.taxSen);
  const built = (): Line[] => lines.filter(l => l.itemCode.trim() && l.description.trim()).map(l => ({ itemCode: l.itemCode.trim(), description: l.description.trim(), uom: l.uom.trim() || 'UNIT', qty: Number(l.qty) || 0, unitPriceSen: rmToSen(l.unitPrice), discountSen: rmToSen(l.discount), lineTotalSen: lineTotal(l) }));
  const canSave = h.customerName.trim() !== '' && built().length > 0;
  const advanceLabel = (() => { const i = FLOW.indexOf(h.status); return i >= 0 && i < FLOW.length - 1 ? STATUS_LABEL[FLOW[i + 1]] : null; })();
  const outstanding = Math.max(0, (isNew ? total : h.totalSen) - h.paidSen);

  return (
    <Drawer open onClose={onClose} width={880}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New sales order' : so.docNo}</h2>{!isNew && <StatusPill status={h.status} />}</div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="md:col-span-2"><Field label="Customer" placeholder="Customer name" value={h.customerName} onChange={setHf('customerName')} disabled={!editable} /></div>
          <Field label="Phone" value={h.customerPhone} onChange={setHf('customerPhone')} disabled={!editable} />
          <Field label="Customer PO" value={h.customerPo} onChange={setHf('customerPo')} disabled={!editable} />
          <Field label="SO date" type="date" value={h.soDate} onChange={setHf('soDate')} disabled={!editable} />
          <Field label="Target date" type="date" value={h.targetDate} onChange={setHf('targetDate')} disabled={!editable} />
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
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Subtotal</span><span className="tabular-nums w-[120px] text-right">{rm(subtotal)}</span></div>
            <div className="flex gap-8 text-[13px] items-center"><span className="text-muted-ink">Tax</span><input type="number" step="0.01" disabled={!editable} value={senToRm(h.taxSen)} onChange={e => setH(s => ({ ...s, taxSen: rmToSen(e.target.value) }))} className="h-8 w-[120px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70" /></div>
            <div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div>
            {!isNew && <>
              <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Paid</span><span className="tabular-nums w-[120px] text-right">{rm(h.paidSen)}</span></div>
              <div className="flex gap-8 text-[13px] font-semibold"><span>Outstanding</span><span className="tabular-nums w-[120px] text-right">{rm(outstanding)}</span></div>
            </>}
          </div>
        </div>

        {!isNew && canWrite && h.status !== 'CANCELLED' && outstanding > 0 && (
          <div className="flex items-center gap-2.5 justify-end">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Record payment</span>
            <input type="number" step="0.01" value={pay} placeholder="0.00" onChange={e => setPay(e.target.value)} className="h-9 w-[130px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />
            <Button size="sm" variant="secondary" disabled={rmToSen(pay) <= 0} disabledReason="Enter an amount" onClick={() => { const amt = Math.min(rmToSen(pay), outstanding); onAct(h, { paySen: amt }, { paidSen: h.paidSen + amt, outstandingSen: outstanding - amt }, 'Payment recorded.'); setPay(''); }}>Record</Button>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page flex-wrap">
        <div className="flex gap-2.5">
          {!isNew && canWrite && h.status !== 'CANCELLED' && h.status !== 'DELIVERED' && h.status !== 'INVOICED' && h.status !== 'CLOSED' &&
            <Button size="sm" variant="danger" onClick={() => onAct(h, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Sales order cancelled.')}>Cancel order</Button>}
          {!isNew && canWrite && h.status === 'ON_HOLD' && <Button size="sm" variant="secondary" onClick={() => onAct(h, { status: 'CONFIRMED' }, { status: 'CONFIRMED' }, 'Order resumed.')}>Resume</Button>}
          {!isNew && canWrite && FLOW.includes(h.status) && h.status !== 'CLOSED' && <Button size="sm" variant="secondary" onClick={() => onAct(h, { status: 'ON_HOLD' }, { status: 'ON_HOLD' }, 'Order put on hold.')}>Hold</Button>}
        </div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {editable && <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a customer and add at least one line" onClick={() => { const l = built(); onSave({ ...h, ...totalsOf(l, h.taxSen) }, l); }}>{isNew ? 'Raise order' : 'Save'}</Button>}
          {!isNew && canWrite && advanceLabel && h.status !== 'ON_HOLD' && <Button size="sm" variant="primary" onClick={() => onAct(h, { action: 'advance' }, { status: FLOW[FLOW.indexOf(h.status) + 1] }, `Advanced to ${advanceLabel}.`)}>Advance → {advanceLabel}</Button>}
        </div>
      </div>
    </Drawer>
  );
}

function Cell({ value, onChange, disabled, w, right, num }: { value: string; onChange: (v: string) => void; disabled?: boolean; w: string; right?: boolean; num?: boolean }) {
  return <input value={value} disabled={disabled} type={num ? 'number' : 'text'} step={num ? '0.01' : undefined} onChange={e => onChange(e.target.value)} style={{ width: w }}
    className={cx('h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70 disabled:bg-transparent disabled:border-transparent', right ? 'text-right tabular-nums' : '')} />;
}
