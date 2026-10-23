import { mayWork } from '../lib/areaAccess';
import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, PhoneInput, DateField, PHONE_SIZING } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useRecord, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, todayMyt } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { statusLabel } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';
import { CloseButton } from '../components/CloseButton';

/** Sales Orders — ported from 2990's SCM (core sell-side doc), drawn in Conts. Header +
 *  lines + 9-state status flow + deposit/payment. Customer inline; DO/SI are next modules. */

type Status = 'CONFIRMED' | 'IN_PRODUCTION' | 'READY_TO_SHIP' | 'SHIPPED' | 'DELIVERED' | 'INVOICED' | 'CLOSED' | 'ON_HOLD' | 'CANCELLED';
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

export default function SalesOrdersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/sales-orders', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayWork(user, 'scSales');

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<So | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [added, setAdded] = useState<So[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<So>>>({});
  useResetOnReload(data, () => {
    setAdded([]); setEdits({});
    setDrawer(d => { const fresh = d?.id ? data?.data.find(x => x.id === d.id) : undefined; return d && fresh ? { ...d, ...fresh, lines: d.lines } : d; });
  });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(p => ({ ...p, ...edits[p.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(p => (statusFilter === 'all' || p.status === statusFilter) && (!q || `${p.docNo} ${p.customerName} ${p.customerPo}`.toLowerCase().includes(q)));
  const outstanding = all.filter(p => p.status !== 'CANCELLED').reduce((s, p) => s + p.outstandingSen, 0);

  const columns = useMemo<Column<So>[]>(() => [
    { key: 'docNo', label: 'SO number', type: 'ref', value: p => p.docNo, hideable: false },
    { key: 'customer', label: 'Customer', value: p => p.customerName, sub: p => p.customerPo ? `PO ${p.customerPo}` : null, text: p => `${p.customerName} ${p.customerPo}`.trim() },
    { key: 'soDate', label: 'SO date', type: 'date', value: p => p.soDate || null },
    { key: 'target', label: 'Target', type: 'date', value: p => p.targetDate || null },
    { key: 'status', label: 'Status', type: 'status', value: p => p.status, entity: 'sales_order' },
    { key: 'total', label: 'Total', type: 'money', value: p => p.totalSen },
    { key: 'outstanding', label: 'Outstanding', type: 'money', value: p => p.status === 'CANCELLED' ? null : p.outstandingSen, render: p => p.status === 'CANCELLED' ? <span className="text-muted-ink">—</span> : <span className="tabular-nums font-semibold">{rm(p.outstandingSen)}</span> },
  ], []);

  function totalsOf(lines: Line[], taxSen: number) { const subtotalSen = lines.reduce((s, l) => s + l.lineTotalSen, 0); return { subtotalSen, taxSen: Math.max(0, taxSen), totalSen: subtotalSen + Math.max(0, taxSen) }; }
  function body(so: So, lines: Line[]) { return { customerName: so.customerName, customerPhone: so.customerPhone, customerPo: so.customerPo, soDate: so.soDate, targetDate: so.targetDate || null, notes: so.notes, taxSen: so.taxSen, depositSen: so.depositSen, lines: lines.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen, discountSen: l.discountSen })) }; }

  function openNew() { setIsNew(true); setDrawer({ id: '', docNo: '', customerName: '', customerPhone: '', customerPo: '', soDate: todayMyt(), targetDate: '', status: 'CONFIRMED', subtotalSen: 0, taxSen: 0, totalSen: 0, depositSen: 0, paidSen: 0, outstandingSen: 0, notes: '', lines: [] }); }
  function save(so: So, lines: Line[]) {
    const t = totalsOf(lines, so.taxSen);
    if (isNew) {
      setAdded(a => [{ ...so, ...t, id: `so-new-${crypto.randomUUID().slice(0, 8)}`, docNo: 'Saving…', outstandingSen: t.totalSen - so.paidSen, lines }, ...a]);
      persist(api.post('/sales-orders', body(so, lines)), { reload, ok: () => toast({ tone: 'success', title: 'Sales order raised.', body: so.customerName }) });
    } else {
      setEdits(e => ({ ...e, [so.id]: { ...e[so.id], ...t, customerName: so.customerName, customerPhone: so.customerPhone, customerPo: so.customerPo, soDate: so.soDate, targetDate: so.targetDate, depositSen: so.depositSen, notes: so.notes, outstandingSen: t.totalSen - so.paidSen, lines } }));
      persist(api.patch(`/sales-orders/${so.id}`, body(so, lines)), { reload, ok: () => toast({ tone: 'success', title: 'Sales order updated.', body: so.docNo }) });
    }
    setDrawer(null);
  }
  function act(so: So, patch: Record<string, unknown>, optimistic: Partial<So>, title: string) {
    setEdits(e => ({ ...e, [so.id]: { ...e[so.id], ...optimistic } }));
    persist(api.patch(`/sales-orders/${so.id}`, patch), { reload, ok: () => toast({ tone: 'success', title, body: so.docNo }) });
    setDrawer(d => d ? { ...d, ...optimistic } : d);
  }

  return (
    <>
      <PageHeader title="Sales orders" sub={data ? `${all.length} ${all.length === 1 ? 'order' : 'orders'} · ${rm(outstanding, { cents: false })} outstanding` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={openNew}>New sales order</Button> : undefined} />
      <DataTable<So>
        id="scm.sales-orders" columns={columns} rows={data ? rows : null} rowKey={p => p.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={p => { setIsNew(false); setDrawer({ ...p, lines: p.lines ?? [] }); }}
        noun={['sales order', 'sales orders']} exportName="sales-orders"
        toolbar={<>
          <Segmented label="Status" options={FILTERS.map(f => ({ key: f, label: f === 'all' ? 'All' : statusLabel('sales_order', f) }))} value={statusFilter} onChange={setStatusFilter} />
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

interface DraftLine { itemCode: string; description: string; uom: string; qty: number | null; unitPriceSen: number | null; discountSen: number | null }
const toDraftLine = (l: Line): DraftLine => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qty: l.qty, unitPriceSen: l.unitPriceSen, discountSen: l.discountSen || null });
const blankLine = (): DraftLine => ({ itemCode: '', description: '', uom: 'UNIT', qty: 1, unitPriceSen: null, discountSen: null });
const lineTotal = (l: DraftLine) => Math.max(0, (l.qty ?? 0) * (l.unitPriceSen ?? 0) - (l.discountSen ?? 0));
const isUsed = (l: DraftLine) => l.itemCode.trim() !== '' && l.description.trim() !== '';
const CELL_CLASS = 'h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70 disabled:bg-transparent disabled:border-transparent text-right tabular-nums';

function SoDrawer({ so, isNew, canWrite, onClose, onSave, onAct, totalsOf }: {
  so: So; isNew: boolean; canWrite: boolean; onClose: () => void; onSave: (s: So, l: Line[]) => void;
  onAct: (s: So, patch: Record<string, unknown>, optimistic: Partial<So>, title: string) => void; totalsOf: (l: Line[], t: number) => { subtotalSen: number; taxSen: number; totalSen: number };
}) {
  const { record, loading: linesLoading, error: linesError } = useRecord<So>('sales-orders', isNew ? null : so.id);
  const editable = canWrite && (isNew || so.status === 'CONFIRMED') && !linesLoading && !linesError;
  const [h, setH] = useState<So>(so);
  const [lines, setLines] = useState<DraftLine[]>((so.lines ?? []).map(toDraftLine));
  useEffect(() => { if (record?.lines) setLines(record.lines.map(toDraftLine)); }, [record]);
  const [taxSen, setTaxSen] = useState<number | null>(so.taxSen || null);
  const [paySen, setPaySen] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setHf = <K extends keyof So>(k: K) => (e: { target: { value: string } }) => setH(s => ({ ...s, [k]: e.target.value as So[K] }));
  const setLine = <K extends keyof DraftLine>(i: number, k: K, v: DraftLine[K]) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const subtotal = !isNew && linesLoading ? so.subtotalSen : lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = subtotal + Math.max(0, taxSen ?? 0);
  const built = (): Line[] => lines.filter(isUsed).map(l => ({ itemCode: l.itemCode.trim(), description: l.description.trim(), uom: l.uom.trim() || 'UNIT', qty: l.qty ?? 0, unitPriceSen: l.unitPriceSen ?? 0, discountSen: l.discountSen ?? 0, lineTotalSen: lineTotal(l) }));
  function problems() {
    const e: Record<string, string> = {};
    lines.forEach((l, i) => {
      if (!isUsed(l)) return;
      if (l.qty == null) e[`qty.${i}`] = 'Enter a quantity.';
      if (l.unitPriceSen == null) e[`price.${i}`] = 'Enter a unit price.';
    });
    if (h.targetDate && h.soDate && h.targetDate < h.soDate) e.targetDate = 'Target date cannot be before the SO date.';
    return e;
  }
  const canSave = h.customerName.trim() !== '' && built().length > 0;
  const advanceLabel = (() => { const i = FLOW.indexOf(so.status); return i >= 0 && i < FLOW.length - 1 ? statusLabel('sales_order', FLOW[i + 1]) : null; })();
  const outstanding = Math.max(0, (isNew ? total : so.totalSen) - so.paidSen);

  return (
    <Drawer open onClose={onClose} width={880}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New sales order' : so.docNo}</h2>{!isNew && <StatusBadge entity="sales_order" value={so.status} />}</div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="md:col-span-2"><Field label="Customer" placeholder="Customer name" value={h.customerName} onChange={setHf('customerName')} disabled={!editable} /></div>
          <PhoneInput label="Phone" value={h.customerPhone} onChange={v => setH(s => ({ ...s, customerPhone: v }))} disabled={!editable} />
          <Field label="Customer PO" value={h.customerPo} onChange={setHf('customerPo')} disabled={!editable} />
          <DateField label="SO date" value={h.soDate} onChange={v => setH(s => ({ ...s, soDate: v }))} disabled={!editable} />
          <DateField label="Target date" value={h.targetDate} min={h.soDate || undefined} error={errors.targetDate} onChange={v => setH(s => ({ ...s, targetDate: v }))} disabled={!editable} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines</div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[720px]">
              <thead><tr className="bg-muted">{['Item code', 'Description', 'UOM', 'Qty', 'Unit price', 'Discount', 'Line total', ''].map((th, i) => <th key={th || i} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i >= 3 && i <= 6 ? 'text-right' : 'text-left')}>{th}</th>)}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft)]">
                    <td className="p-1.5"><Cell value={l.itemCode} onChange={v => setLine(i, 'itemCode', v)} disabled={!editable} w="130px" /></td>
                    <td className="p-1.5"><Cell value={l.description} onChange={v => setLine(i, 'description', v)} disabled={!editable} w="100%" /></td>
                    <td className="p-1.5"><Cell value={l.uom} onChange={v => setLine(i, 'uom', v)} disabled={!editable} w="70px" /></td>
                    <td className="p-1.5"><NumberInput aria-label={`Line ${i + 1} quantity`} value={l.qty} min={0} onChange={v => setLine(i, 'qty', v)} disabled={!editable} error={errors[`qty.${i}`]} className={CELL_CLASS} style={{ width: '64px' }} /></td>
                    <td className="p-1.5"><MoneyInput aria-label={`Line ${i + 1} unit price`} valueSen={l.unitPriceSen} onChangeSen={v => setLine(i, 'unitPriceSen', v)} disabled={!editable} error={errors[`price.${i}`]} className={CELL_CLASS} style={{ width: '96px' }} /></td>
                    <td className="p-1.5"><MoneyInput aria-label={`Line ${i + 1} discount`} valueSen={l.discountSen} onChangeSen={v => setLine(i, 'discountSen', v)} disabled={!editable} className={CELL_CLASS} style={{ width: '90px' }} /></td>
                    <td className="p-1.5 text-right tabular-nums text-[13px] whitespace-nowrap">{rm(lineTotal(l))}</td>
                    <td className="p-1.5 text-center">{editable && <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line" className="text-muted-ink hover:text-danger bg-transparent border-none cursor-pointer p-1"><Trash2 size={15} /></button>}</td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[12.5px] text-muted-ink">{linesLoading ? 'Loading lines…' : linesError ?? 'No lines yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {editable && <div><Button size="sm" variant="secondary" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setLines(ls => [...ls, blankLine()])}>Add line</Button></div>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={h.notes} onChange={setHf('notes')} disabled={!editable} />
          <div className="flex flex-col gap-1.5 items-end justify-end">
            <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Subtotal</span><span className="tabular-nums w-[120px] text-right">{rm(subtotal)}</span></div>
            <div className="flex gap-8 text-[13px] items-center"><span className="text-muted-ink">Tax</span><MoneyInput aria-label="Tax (RM)" disabled={!editable} valueSen={taxSen} onChangeSen={setTaxSen} className="h-8 w-[120px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70" /></div>
            <div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div>
            {!isNew && <>
              <div className="flex gap-8 text-[13px]"><span className="text-muted-ink">Paid</span><span className="tabular-nums w-[120px] text-right">{rm(so.paidSen)}</span></div>
              <div className="flex gap-8 text-[13px] font-semibold"><span>Outstanding</span><span className="tabular-nums w-[120px] text-right">{rm(outstanding)}</span></div>
            </>}
          </div>
        </div>

        {!isNew && canWrite && so.status !== 'CANCELLED' && outstanding > 0 && (
          <div className="flex items-center gap-2.5 justify-end">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Record payment</span>
            <MoneyInput aria-label="Payment amount (RM)" valueSen={paySen} onChangeSen={setPaySen} className="h-9 w-[130px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />
            <Button size="sm" variant="secondary" disabled={!paySen || paySen <= 0} disabledReason="Enter an amount" onClick={() => { const amt = Math.min(paySen ?? 0, outstanding); onAct(so, { paySen: amt }, { paidSen: so.paidSen + amt, outstandingSen: outstanding - amt }, 'Payment recorded.'); setPaySen(null); }}>Record</Button>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page flex-wrap">
        <div className="flex gap-2.5">
          {!isNew && canWrite && so.status !== 'CANCELLED' && so.status !== 'DELIVERED' && so.status !== 'INVOICED' && so.status !== 'CLOSED' &&
            <ConfirmButton confirm={{ title: `Cancel ${so.docNo}?`, body: 'It is marked Cancelled and can no longer be delivered.', meta: `${so.customerName} · ${rm(so.totalSen)}`, confirmLabel: 'Cancel order', cancelLabel: 'Keep order' }} onConfirm={() => onAct(so, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Sales order cancelled.')}>Cancel order</ConfirmButton>}
          {!isNew && canWrite && so.status === 'ON_HOLD' && <Button size="sm" variant="secondary" onClick={() => onAct(so, { status: 'CONFIRMED' }, { status: 'CONFIRMED' }, 'Order resumed.')}>Resume</Button>}
          {!isNew && canWrite && FLOW.includes(so.status) && so.status !== 'CLOSED' && <Button size="sm" variant="secondary" onClick={() => onAct(so, { status: 'ON_HOLD' }, { status: 'ON_HOLD' }, 'Order put on hold.')}>Hold</Button>}
        </div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {editable && <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a customer and add at least one line" onClick={() => { const e = problems(); setErrors(e); if (Object.keys(e).length) return; const l = built(); onSave({ ...h, ...totalsOf(l, taxSen ?? 0) }, l); }}>{isNew ? 'Raise order' : 'Save'}</Button>}
          {!isNew && canWrite && advanceLabel && so.status !== 'ON_HOLD' && <Button size="sm" variant="primary" onClick={() => onAct(so, { action: 'advance' }, { status: FLOW[FLOW.indexOf(so.status) + 1] }, `Advanced to ${advanceLabel}.`)}>Advance → {advanceLabel}</Button>}
        </div>
      </div>
    </Drawer>
  );
}

function Cell({ value, onChange, disabled, w }: { value: string; onChange: (v: string) => void; disabled?: boolean; w: string }) {
  return <input value={value} disabled={disabled} onChange={e => onChange(e.target.value)} style={{ width: w }}
    className={`h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-70 disabled:bg-transparent disabled:border-transparent ${PHONE_SIZING}`} />;
}
