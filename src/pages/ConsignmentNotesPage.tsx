import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Trash2, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, PhoneInput, DateField } from '../components/inputs';
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

/** Consignment Notes (sell-side) — ported from 2990's SCM, drawn in Conts. Consign stock out
 *  to a consignee; track consigned / sold / returned per line. */

type Status = 'OPEN' | 'PARTIALLY_SETTLED' | 'CLOSED' | 'CANCELLED';
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
  useResetOnReload(data, () => {
    setAdded([]); setEdits({});
    setDrawer(d => { const fresh = d?.mode === 'view' ? data?.data.find(x => x.id === d.cn.id) : undefined; return d?.mode === 'view' && fresh ? { mode: 'view', cn: { ...d.cn, ...fresh } } : d; });
  });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].map(c => ({ ...c, ...edits[c.id] })), [added, data, edits]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(c => (statusFilter === 'all' || c.status === statusFilter) && (!q || `${c.cnNumber} ${c.consigneeName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Cn>[]>(() => [
    { key: 'cnNumber', label: 'CN number', type: 'ref', value: c => c.cnNumber, hideable: false },
    { key: 'consignee', label: 'Consignee', value: c => c.consigneeName },
    { key: 'cnDate', label: 'Date', type: 'date', value: c => c.cnDate || null },
    { key: 'status', label: 'Status', type: 'status', value: c => c.status, entity: 'consignment_note' },
    { key: 'value', label: 'Value', type: 'money', value: c => c.totalSen, render: c => <span className="tabular-nums font-semibold">{rm(c.totalSen)}</span> },
  ], []);

  function created(cn: Cn, req: Promise<unknown>) { setAdded(a => [cn, ...a]); setDrawer(null); persist(req, { reload, ok: () => toast({ tone: 'success', title: 'Consignment note raised.', body: cn.consigneeName }) }); }
  function act(cn: Cn, patch: Record<string, unknown>, optimistic: Partial<Cn>, title: string) {
    setEdits(e => ({ ...e, [cn.id]: { ...e[cn.id], ...optimistic } }));
    persist(api.patch(`/consignment-notes/${cn.id}`, patch), { reload, ok: () => toast({ tone: 'success', title, body: cn.cnNumber }) });
    setDrawer(d => d && d.mode === 'view' ? { mode: 'view', cn: { ...d.cn, ...optimistic } } : d);
  }

  return (
    <>
      <PageHeader title="Consignment notes" sub={data ? `${all.length} ${all.length === 1 ? 'note' : 'notes'} · stock consigned out` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New consignment note</Button> : undefined} />
      <DataTable<Cn>
        id="scm.consignment-notes" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={c => setDrawer({ mode: 'view', cn: c })}
        noun={['consignment note', 'consignment notes']} exportName="consignment-notes"
        toolbar={<>
          <Segmented label="Status" options={FILTERS.map(f => ({ key: f, label: f === 'all' ? 'All' : statusLabel('consignment_note', f) }))} value={statusFilter} onChange={setStatusFilter} />
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

interface DraftLine { itemCode: string; description: string; uom: string; qty: number | null; unitPriceSen: number | null }
const blankLine = (): DraftLine => ({ itemCode: '', description: '', uom: 'UNIT', qty: 1, unitPriceSen: null });
const lineTotal = (l: DraftLine) => Math.max(0, (l.qty ?? 0) * (l.unitPriceSen ?? 0));
const CELL_NUM = 'h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none text-right tabular-nums';

function CreateDrawer({ canWrite, onClose, onCreated }: { canWrite: boolean; onClose: () => void; onCreated: (c: Cn, req: Promise<unknown>) => void }) {
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneePhone, setConsigneePhone] = useState('');
  const [cnDate, setCnDate] = useState(todayMyt());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setLine = <K extends keyof DraftLine>(i: number, k: K, v: DraftLine[K]) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const isUsed = (l: DraftLine) => l.itemCode.trim() !== '' && l.description.trim() !== '';
  const built = () => lines.filter(l => isUsed(l) && (l.qty ?? 0) > 0).map(l => ({ itemCode: l.itemCode.trim(), description: l.description.trim(), uom: l.uom.trim() || 'UNIT', qtyConsigned: l.qty ?? 0, unitPriceSen: l.unitPriceSen ?? 0 }));
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const canSave = canWrite && consigneeName.trim() !== '' && built().length > 0;

  function submit() {
    const e: Record<string, string> = {};
    lines.forEach((l, i) => {
      if (!isUsed(l)) return;
      if (l.qty == null) e[`qty.${i}`] = 'Enter a quantity.';
      if (l.unitPriceSen == null) e[`price.${i}`] = 'Enter a unit price.';
    });
    if (!cnDate) e.cnDate = 'Enter the date.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const b = built();
    const req = api.post('/consignment-notes', { consigneeName, consigneePhone, cnDate, notes, lines: b });
    onCreated({ id: `cn-new-${crypto.randomUUID().slice(0, 8)}`, cnNumber: 'Saving…', consigneeName, consigneePhone, cnDate, status: 'OPEN', totalSen: total, notes,
      lines: b.map(l => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, qtyConsigned: l.qtyConsigned, qtySold: 0, qtyReturned: 0, unitPriceSen: l.unitPriceSen, lineTotalSen: l.qtyConsigned * l.unitPriceSen })) }, req);
  }

  return (
    <Drawer open onClose={onClose} width={820}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New consignment note</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          <Field label="Consignee" placeholder="Showroom / retailer" value={consigneeName} onChange={e => setConsigneeName(e.target.value)} />
          <PhoneInput label="Phone" value={consigneePhone} onChange={setConsigneePhone} />
          <DateField label="Date" required value={cnDate} error={errors.cnDate} onChange={setCnDate} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines to consign</div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[640px]">
              <thead><tr className="bg-muted">{['Item code', 'Description', 'UOM', 'Qty', 'Unit price', 'Line total', ''].map((th, i) => <th key={th || i} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i >= 3 && i <= 5 ? 'text-right' : 'text-left')}>{th}</th>)}</tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft)]">
                    <td className="p-1.5"><Cell value={l.itemCode} onChange={v => setLine(i, 'itemCode', v)} w="130px" /></td>
                    <td className="p-1.5"><Cell value={l.description} onChange={v => setLine(i, 'description', v)} w="100%" /></td>
                    <td className="p-1.5"><Cell value={l.uom} onChange={v => setLine(i, 'uom', v)} w="70px" /></td>
                    <td className="p-1.5"><NumberInput aria-label={`Line ${i + 1} quantity`} min={0} value={l.qty} error={errors[`qty.${i}`]} onChange={v => setLine(i, 'qty', v)} className={CELL_NUM} style={{ width: '64px' }} /></td>
                    <td className="p-1.5"><MoneyInput aria-label={`Line ${i + 1} unit price`} valueSen={l.unitPriceSen} error={errors[`price.${i}`]} onChangeSen={v => setLine(i, 'unitPriceSen', v)} className={CELL_NUM} style={{ width: '96px' }} /></td>
                    <td className="p-1.5 text-right tabular-nums text-[13px] whitespace-nowrap">{rm(lineTotal(l))}</td>
                    <td className="p-1.5 text-center"><button onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} aria-label="Remove line" className="text-muted-ink hover:text-danger bg-transparent border-none cursor-pointer p-1"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><Button size="sm" variant="secondary" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setLines(ls => [...ls, blankLine()])}>Add line</Button></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex items-end justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Consigned value</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div></div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a consignee and at least one line" onClick={submit}>Raise note</Button>
      </div>
    </Drawer>
  );
}

function SettleDrawer({ cn, canWrite, onClose, onAct }: { cn: Cn; canWrite: boolean; onClose: () => void; onAct: (c: Cn, patch: Record<string, unknown>, optimistic: Partial<Cn>, title: string) => void }) {
  const { record, loading: linesLoading, error: linesError } = useRecord<Cn>('consignment-notes', cn.id);
  const lines = cn.lines ?? record?.lines ?? [];
  const [qty, setQty] = useState<{ sold: number | null; returned: number | null }[]>(lines.map(l => ({ sold: l.qtySold, returned: l.qtyReturned })));
  useEffect(() => { if (record?.lines) setQty(record.lines.map(l => ({ sold: l.qtySold, returned: l.qtyReturned }))); }, [record]);
  const editable = canWrite && (cn.status === 'OPEN' || cn.status === 'PARTIALLY_SETTLED') && !linesLoading && !linesError && qty.length === lines.length;
  const [submitted, setSubmitted] = useState(false);
  const setLine = (i: number, k: 'sold' | 'returned', v: number | null) => setQty(qs => qs.map((q, j) => j === i ? { ...q, [k]: v } : q));
  const overError = (i: number) => (qty[i].sold ?? 0) + (qty[i].returned ?? 0) > lines[i].qtyConsigned ? `Sold and returned cannot exceed ${lines[i].qtyConsigned}.` : undefined;
  const emptyError = (v: number | null) => submitted && v == null ? 'Enter a number.' : undefined;

  function saveSettlement() {
    setSubmitted(true);
    if (qty.some((q, i) => q.sold == null || q.returned == null || overError(i))) return;
    const settled = lines.map((l, i) => ({ ...l, qtySold: qty[i].sold ?? 0, qtyReturned: qty[i].returned ?? 0 }));
    onAct(cn, { lines: settled.map(l => ({ id: l.id, qtySold: l.qtySold, qtyReturned: l.qtyReturned })) }, { lines: settled }, 'Settlement saved.');
  }

  return (
    <Drawer open onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{cn.cnNumber}</h2><StatusBadge entity="consignment_note" value={cn.status} /></div>
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
                <tr key={l.id ?? i} className="[border-top:1px_solid_var(--color-line-soft)]">
                  <td className="py-2 px-3"><div className="flex flex-col"><span className="text-[13px]">{l.description}</span><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px] text-muted-ink">{l.itemCode}</span></div></td>
                  <td className="py-2 px-3 text-right tabular-nums text-[13px]">{l.qtyConsigned}</td>
                  <td className="py-2 px-3 text-right">{editable ? <NumCell label={`Sold quantity for ${l.itemCode}`} value={qty[i].sold} error={overError(i) ?? emptyError(qty[i].sold)} onChange={v => setLine(i, 'sold', v)} /> : <span className="tabular-nums text-[13px]">{l.qtySold}</span>}</td>
                  <td className="py-2 px-3 text-right">{editable ? <NumCell label={`Returned quantity for ${l.itemCode}`} value={qty[i].returned} error={emptyError(qty[i].returned)} onChange={v => setLine(i, 'returned', v)} /> : <span className="tabular-nums text-[13px]">{l.qtyReturned}</span>}</td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[12.5px] text-muted-ink">{linesLoading ? 'Loading lines…' : linesError ?? 'No lines on this note.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {cn.notes && <div className="text-[13px]"><span className="text-muted-ink">Notes: </span>{cn.notes}</div>}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && cn.status !== 'CANCELLED' && cn.status !== 'CLOSED' && <ConfirmButton confirm={{ title: `Cancel ${cn.cnNumber}?`, body: 'It is marked Cancelled and can no longer be settled.', meta: cn.consigneeName, confirmLabel: 'Cancel note', cancelLabel: 'Keep note' }} onConfirm={() => onAct(cn, { status: 'CANCELLED' }, { status: 'CANCELLED' }, 'Note cancelled.')}>Cancel</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          {canWrite && cn.status !== 'CANCELLED' && cn.status !== 'CLOSED' && <Button size="sm" variant="secondary" onClick={() => onAct(cn, { status: 'CLOSED' }, { status: 'CLOSED' }, 'Note closed.')}>Close</Button>}
          {editable && <Button size="sm" variant="primary" onClick={saveSettlement}>Save settlement</Button>}
          <Button size="sm" variant="secondary" onClick={onClose}>Close panel</Button>
        </div>
      </div>
    </Drawer>
  );
}

function Cell({ value, onChange, w }: { value: string; onChange: (v: string) => void; w: string }) {
  return <input value={value} onChange={e => onChange(e.target.value)} style={{ width: w }}
    className="h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" />;
}
function NumCell({ label, value, error, onChange }: { label: string; value: number | null; error?: string; onChange: (v: number | null) => void }) {
  return <NumberInput aria-label={label} min={0} value={value} error={error} onChange={onChange} className="h-8 w-[70px] box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />;
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className="text-[13.5px]">{value}</span></div>;
}
