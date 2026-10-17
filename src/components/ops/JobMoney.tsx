import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { DataTable, type Column } from '../DataTable';
import { Skeleton } from '../States';
import { StaleBanner } from '../DataState';
import { Select } from '../Select';
import { MoneyInput, NumberInput, DateField } from '../inputs';
import { useToast } from '../Toast';
import { useConfirm } from '../ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import { rm, date as dayText, monthLabel } from '../../lib/format';
import { OpsModal, FormRow, INPUT, mytDay } from './OpsUi';

/* Billing, actual cost and profit of a job (functions/_lib/jobProfit.ts, owner 17 Oct 2026). Amounts in sen. */
type Kind = 'maintenance' | 'cleaning';
interface Invoice { id: string; supplier: string | null; invoiceNo: string | null; date: string; amount: number; documentId: string | null; enteredBy: string | null }
interface Line { id: string; itemId: string | null; code: string | null; name: string; qty: number; ownerPrice: number; internalCost: number | null }
export interface JobMoneyData {
  ready: boolean; money: boolean; billed: number | null; billedSource: string; actual: number | null; actualSource: 'invoice' | 'estimate' | 'cleaner_pay' | null;
  estimate: number | null; profit: number | null; invoices: Invoice[]; lines?: Line[];
}
export interface CatalogEntry { id: string; code: string; name: string; category: string; active: boolean; defaultPrice?: number | null; internalCost?: number | null }

const COST_SOURCE: Record<string, string> = { invoice: 'From invoices', estimate: 'Estimated', cleaner_pay: "Cleaner's pay" };
const BILLED_SOURCE: Record<string, string> = { statement: 'On the owner statement', charged: 'Charged to the payer', quote: 'Quote, not billed yet', price: 'List price, not billed yet', none: 'Paid by The Conts: nothing billed' };

/* ---- lines (the items a maintenance job is made of) ---- */

export interface DraftLine { key: string; itemId: string; qty: number | null; name: string; ownerPrice: number | null; internalCost: number | null }
export const newLine = (): DraftLine => ({ key: Math.random().toString(36).slice(2), itemId: '', qty: 1, name: '', ownerPrice: null, internalCost: null });
/** What the server takes: an item and a quantity, or an Other line with typed figures. Empty rows are dropped. */
export const linesPayload = (lines: DraftLine[]) => lines.filter(l => l.itemId).map(l => l.itemId === 'other'
  ? { itemId: null, name: l.name.trim(), qty: l.qty ?? 0, ownerPrice: l.ownerPrice ?? -1, internalCost: l.internalCost }
  : { itemId: l.itemId, qty: l.qty ?? 0 });
export const draftTotal = (lines: DraftLine[], catalog: CatalogEntry[]) => lines.reduce((n, l) => {
  const unit = l.itemId === 'other' ? l.ownerPrice : catalog.find(c => c.id === l.itemId)?.defaultPrice ?? null;
  return n + Math.round((unit ?? 0) * (l.qty ?? 0));
}, 0);

/** Pick items with a quantity; Other (not on the list) takes typed figures. The total is the job's owner price. */
export function LinesEditor({ lines, catalog, onChange, money }: { lines: DraftLine[]; catalog: CatalogEntry[]; onChange: (l: DraftLine[]) => void; money: boolean }) {
  const set = (key: string, p: Partial<DraftLine>) => onChange(lines.map(l => (l.key === key ? { ...l, ...p } : l)));
  const options = useMemo(() => [{ value: '', label: 'Pick an item' }, ...catalog.filter(c => c.active).map(c => ({ value: c.id, label: `${c.name} (${c.code})`, hint: c.defaultPrice != null ? rm(c.defaultPrice) : 'No price' })), { value: 'other', label: 'Other (not on the list)' }], [catalog]);
  const total = draftTotal(lines, catalog);
  return (
    <div className="flex flex-col gap-2">
      {lines.map(l => {
        const c = catalog.find(x => x.id === l.itemId);
        const unit = l.itemId === 'other' ? l.ownerPrice : c?.defaultPrice ?? null;
        return (
          <div key={l.key} className="flex flex-col gap-1.5 p-2 rounded-control border border-solid border-line bg-card">
            <div className="grid grid-cols-[minmax(0,1fr)_88px_auto] gap-2 items-center">
              <Select size="md" label="Item" value={l.itemId} onChange={v => set(l.key, { itemId: v })} options={options} />
              <NumberInput className={INPUT} value={l.qty} onChange={v => set(l.key, { qty: v })} min={0} decimals={2} aria-label="Quantity" />
              <button type="button" onClick={() => onChange(lines.filter(x => x.key !== l.key))} aria-label="Remove item"
                className="h-10 px-2 bg-transparent border-0 text-muted-ink cursor-pointer [font-family:inherit]">Remove</button>
            </div>
            {l.itemId === 'other' && (
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 max-sm:grid-cols-1">
                <input className={INPUT} value={l.name} onChange={e => set(l.key, { name: e.target.value })} placeholder="What it is" aria-label="Other item" maxLength={160} />
                <MoneyInput className={INPUT} valueSen={l.ownerPrice} onChangeSen={v => set(l.key, { ownerPrice: v })} placeholder="Owner price" aria-label="Owner price each" />
                <MoneyInput className={INPUT} valueSen={l.internalCost} onChangeSen={v => set(l.key, { internalCost: v })} placeholder="Internal cost" aria-label="Internal cost each" />
              </div>
            )}
            {l.itemId && unit != null && <span className="text-meta text-muted-ink tabular-nums">{rm(unit)} each{l.qty && l.qty !== 1 ? ` x ${l.qty} = ${rm(Math.round(unit * l.qty))}` : ''}{money && l.itemId !== 'other' && c?.internalCost != null ? ` · internal ${rm(c.internalCost)} each` : ''}</span>}
          </div>
        );
      })}
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="secondary" onClick={() => onChange([...lines, newLine()])}>Add item</Button>
        <span className="flex-1" />
        {lines.some(l => l.itemId) && <span className="text-copy">Owner price <b className="tabular-nums">{rm(total)}</b></span>}
      </div>
    </div>
  );
}

/* ---- a job's money panel ---- */

/** On a job: (maintenance) its items, then what is billed, the actual cost (invoices, else an estimate) and the profit,
 *  the invoices submitted and "Submit invoice". The actual cost and profit are The Conts' figures, never the owner's. */
export function JobMoneyPanel({ kind, jobId, unitId, catalog, itemsLocked, onChanged, fallback }: {
  kind: Kind; jobId: string; unitId: string | null; catalog?: CatalogEntry[]; itemsLocked?: string | null; onChanged?: () => void;
  /** Shown instead before the database update (0127) that brings job items and invoices. */
  fallback?: ReactNode;
}) {
  const q = useApi<JobMoneyData>(`/operations/job-money?kind=${kind}&id=${encodeURIComponent(jobId)}`);
  const toast = useToast();
  const [confirmUi, askFirst] = useConfirm();
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const reload = () => { q.reload(); onChanged?.(); };
  useEffect(() => {
    if (!editing && d?.lines) setDraft(d.lines.map(l => ({ key: l.id, itemId: l.itemId ?? 'other', qty: l.qty, name: l.name, ownerPrice: l.itemId ? null : l.ownerPrice, internalCost: l.itemId ? null : l.internalCost })));
  }, [d, editing]);
  if (!d) return q.error ? <StaleBanner message={q.error} onRetry={q.reload} /> : <Skeleton height={80} />;
  if (!d.ready) return <>{fallback ?? null}</>;
  async function saveLines() {
    setBusy(true);
    try { await api.put(`/maintenance/issues/${jobId}/items`, { items: linesPayload(draft) }); toast({ tone: 'success', title: 'Items saved.', body: 'The quote is their total.' }); setEditing(false); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  async function removeInvoice(i: Invoice) {
    const ok = await askFirst({ title: 'Take back this invoice?', body: `${i.supplier ?? 'Invoice'} ${i.invoiceNo ?? ''}, ${rm(i.amount)}. The job's actual cost is worked out again without it.`, confirmLabel: 'Take back invoice', danger: true });
    if (ok === null) return;
    try { await api.del(`/operations/job-invoices/${i.id}`); toast({ tone: 'success', title: 'Invoice taken back.' }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not taken back.', body: errorMessage(e) }); }
  }
  return (
    <div className="flex flex-col gap-3">
      {confirmUi}
      {kind === 'maintenance' && catalog && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <b className="text-copy flex-1">Items</b>
            {!editing && !itemsLocked && <Button size="sm" variant="secondary" onClick={() => { setEditing(true); if (!draft.length) setDraft([newLine()]); }}>{d.lines?.length ? 'Change items' : 'Pick items'}</Button>}
          </div>
          {editing ? (
            <>
              <LinesEditor lines={draft} catalog={catalog} onChange={setDraft} money={d.money} />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} onClick={() => void saveLines()}>Save items</Button>
              </div>
            </>
          ) : d.lines?.length ? (
            <ul className="m-0 p-0 list-none flex flex-col text-copy">
              {d.lines.map(l => (
                <li key={l.id} className="flex gap-2 py-1 [border-top:1px_solid_var(--color-line-soft)]">
                  <span className="flex-1 min-w-0">{l.name}{l.code ? <span className="text-muted-ink"> · {l.code}</span> : <span className="text-muted-ink"> · Other</span>}</span>
                  <span className="text-muted-ink tabular-nums">{l.qty} x {rm(l.ownerPrice)}</span>
                  <b className="tabular-nums">{rm(Math.round(l.qty * l.ownerPrice))}</b>
                </li>
              ))}
            </ul>
          ) : <span className="text-meta text-muted-ink">{itemsLocked ?? 'No items yet. Pick the items from Service prices; their total becomes the quote.'}</span>}
          {itemsLocked && d.lines?.length ? <span className="text-meta text-muted-ink">{itemsLocked}</span> : null}
        </div>
      )}
      {d.money && (
        <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
          <Figure label="Billed" value={d.billed} note={BILLED_SOURCE[d.billedSource] ?? ''} />
          <Figure label="Actual cost" value={d.actual} note={d.actualSource ? COST_SOURCE[d.actualSource] : 'Not known yet'} tone={d.actualSource === 'estimate' ? 'warning' : undefined} />
          <Figure label="Profit" value={d.profit} note={d.profit == null ? 'Needs the cost' : d.actualSource === 'invoice' ? 'Billed less invoices' : 'Estimated'} strong />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <b className="text-copy flex-1">Invoices {d.invoices.length ? `(${d.invoices.length})` : ''}</b>
          <Button size="sm" variant="secondary" onClick={() => setSubmitting(true)} disabled={!unitId} disabledReason="An external cleaning job is costed by the cleaner's pay.">Submit invoice</Button>
        </div>
        {d.invoices.length === 0 ? <span className="text-meta text-muted-ink">No supplier, contractor or cleaner invoice yet{d.money && d.actual != null ? ': the actual cost is an estimate until one comes in.' : '.'}</span> : (
          <ul className="m-0 p-0 list-none flex flex-col text-copy">
            {d.invoices.map(i => (
              <li key={i.id} className="flex items-center gap-2 py-1.5 [border-top:1px_solid_var(--color-line-soft)] flex-wrap">
                <span className="flex-1 min-w-[160px]"><b>{i.supplier ?? 'Supplier'}</b> <span className="text-muted-ink">· {i.invoiceNo} · {dayText(i.date)}</span></span>
                {i.documentId && <a className="text-gold-ink" href={`/api/documents/${encodeURIComponent(i.documentId)}/download`} target="_blank" rel="noopener">File</a>}
                <b className="tabular-nums">{rm(i.amount)}</b>
                {d.money && <button type="button" onClick={() => void removeInvoice(i)} className="bg-transparent border-0 p-0 text-muted-ink cursor-pointer [font-family:inherit] text-meta">Take back</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {submitting && unitId && <SubmitInvoiceModal kind={kind} jobId={jobId} unitId={unitId} onClose={() => setSubmitting(false)} onDone={() => { setSubmitting(false); toast({ tone: 'success', title: 'Invoice submitted.', body: 'It is now the job\'s actual cost.' }); reload(); }} />}
    </div>
  );
}

function Figure({ label, value, note, tone, strong }: { label: string; value: number | null; note: string; tone?: 'warning'; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 p-2.5 rounded-control bg-page border border-solid border-line">
      <span className="text-meta text-muted-ink">{label}</span>
      <span className={cx('tabular-nums', strong ? 'text-heading font-semibold' : 'text-copy font-semibold', value != null && value < 0 && 'text-danger')}>{value == null ? '–' : rm(value)}</span>
      <span className={cx('text-meta', tone === 'warning' ? 'text-warning' : 'text-muted-ink')}>{note}</span>
    </div>
  );
}

export function SubmitInvoiceModal({ kind, jobId, unitId, onClose, onDone }: { kind: Kind; jobId: string; unitId: string; onClose: () => void; onDone: () => void }) {
  const [supplier, setSupplier] = useState('');
  const [no, setNo] = useState('');
  const [day, setDay] = useState(mytDay(0));
  const [amount, setAmount] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Record<string, string | undefined>>({});
  async function save() {
    const bad = { supplierName: supplier.trim() ? undefined : 'Enter who sent it.', invoiceNo: no.trim() ? undefined : 'Enter the invoice number.', amount: amount && amount > 0 ? undefined : 'Enter the amount.', file: file ? undefined : 'Attach the invoice.' };
    if (Object.values(bad).some(Boolean)) { setError(bad); return; }
    setBusy(true); setError({});
    try {
      const fd = new FormData();
      fd.append('file', file!); fd.append('unitId', unitId); fd.append('kind', 'receipt');
      const doc = await api.post<{ id: string }>('/documents', fd);
      await api.post('/operations/job-invoices', { kind, jobId, supplierName: supplier.trim(), invoiceNo: no.trim(), invoiceDate: day, amount, documentId: doc.id });
      onDone();
    } catch (e) {
      const f = e instanceof ApiFailure ? e.fields ?? {} : {};
      setError({ ...f, form: Object.keys(f).length ? undefined : errorMessage(e, 'Not saved. Try again.') });
      setBusy(false);
    }
  }
  return (
    <OpsModal title="Submit invoice" sub={kind === 'maintenance' ? "The supplier's or contractor's invoice for this job. It becomes the job's actual cost; the owner never sees it." : "The cleaner's or vendor's invoice for this clean. It becomes its actual cost; the owner never sees it."} onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Submit invoice</Button></>}>
      <FormRow label={kind === 'maintenance' ? 'Supplier or contractor' : 'Cleaner or vendor'} error={error.supplierName}>
        <input className={INPUT} value={supplier} onChange={e => setSupplier(e.target.value)} maxLength={120} />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Invoice number" error={error.invoiceNo}><input className={INPUT} value={no} onChange={e => setNo(e.target.value)} maxLength={60} /></FormRow>
        <FormRow label="Invoice date" error={error.invoiceDate}><DateField aria-label="Invoice date" className={INPUT} value={day} onChange={v => v && setDay(v)} /></FormRow>
      </div>
      <FormRow label="Amount, RM" error={error.amount}><MoneyInput className={INPUT} valueSen={amount} onChangeSen={setAmount} aria-label="Invoice amount" /></FormRow>
      <FormRow label="Invoice file" error={error.file} hint="A photo or PDF of the invoice. Required.">
        <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} aria-label="Invoice file" className="text-copy" />
      </FormRow>
      {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
    </OpsModal>
  );
}

/* ---- Profit by job ---- */

interface ProfitRow {
  id: string; title: string; category: string; chargeTo: string; who: string | null; day: string; unitId: string | null; unitNumber: string; buildingId: string; building: string;
  billed: number; billedSource: string; actual: number | null; actualSource: string | null; invoices: number; profit: number | null;
}
interface ProfitPayload { kind: Kind; month: string; rows: ProfitRow[]; totals: { jobs: number; billed: number; actual: number; profit: number; estimated: number; unknown: number } }
const lastMonths = (n: number) => Array.from({ length: n }, (_, k) => { const d = new Date(`${mytDay(0).slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
const CATEGORY_WORD: Record<string, string> = { turnover: 'Standard clean', deep_clean: 'Deep clean', light_clean: 'Light clean', aircon: 'Aircon', plumbing: 'Plumbing', electrical: 'Electrical', furniture: 'Furniture', appliance: 'Appliance', cleaning: 'Cleaning', general: 'General', other: 'Other' };

/** Profit by job for a month: billed, actual cost and profit of every job finished in it, filterable, with totals and the
 *  table's own CSV export. */
export function JobProfitView({ kind, onOpen }: { kind: Kind; onOpen?: (id: string) => void }) {
  const [month, setMonth] = useState(mytDay(0).slice(0, 7));
  const [building, setBuilding] = useState('');
  const [who, setWho] = useState('');
  const q = useApi<ProfitPayload>(`/operations/job-profit?kind=${kind}&month=${month}`);
  const all = q.data?.rows ?? [];
  const rows = all.filter(r => (!building || r.buildingId === building) && (!who || (r.who ?? '') === who));
  const t = { billed: rows.reduce((n, r) => n + r.billed, 0), actual: rows.reduce((n, r) => n + (r.actual ?? 0), 0), profit: rows.reduce((n, r) => n + (r.profit ?? 0), 0) };
  const buildings = [...new Map(all.map(r => [r.buildingId, r.building])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const people = [...new Set(all.map(r => r.who ?? ''))].filter(Boolean).sort();
  const columns = useMemo<Column<ProfitRow>[]>(() => [
    { key: 'day', label: 'Finished', type: 'date', value: r => r.day, width: 110 },
    { key: 'unit', label: 'Unit', value: r => `${r.building} ${r.unitNumber}`, width: 160, phone: 'title', render: r => <span><b>{r.unitNumber}</b> <span className="text-muted-ink">{r.building}</span></span> },
    { key: 'job', label: kind === 'maintenance' ? 'Job' : 'Clean', value: r => r.title, width: 200, sub: r => (kind === 'maintenance' && r.chargeTo !== 'owner' ? `Paid by ${r.chargeTo === 'the_conts' ? 'The Conts' : r.chargeTo.replace('_', ' ')}` : null) },
    { key: 'category', label: 'Category', value: r => CATEGORY_WORD[r.category] ?? r.category, width: 120 },
    { key: 'who', label: kind === 'maintenance' ? 'Contractor' : 'Cleaner', value: r => r.who ?? '', width: 140 },
    { key: 'billed', label: 'Billed', type: 'money', value: r => r.billed, width: 120, align: 'right' },
    { key: 'actual', label: 'Actual cost', type: 'money', value: r => r.actual, width: 130, align: 'right',
      sub: r => (r.actualSource === 'invoice' ? `${r.invoices} ${r.invoices === 1 ? 'invoice' : 'invoices'}` : r.actualSource === 'cleaner_pay' ? "Cleaner's pay" : r.actualSource === 'estimate' ? 'Estimated' : 'Not known') },
    { key: 'profit', label: 'Profit', type: 'money', value: r => r.profit, width: 120, align: 'right', phone: 'right',
      render: r => (r.profit == null ? <span className="text-muted-ink">–</span> : <b className={cx('tabular-nums', r.profit < 0 && 'text-danger')}>{rm(r.profit)}</b>) },
  ], [kind]);
  return (
    <div className="flex flex-col gap-3">
      {q.error && <StaleBanner message={q.error} onRetry={q.reload} />}
      <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
        <Total label={`Jobs in ${monthLabel(`${month}-01`)}`} text={String(rows.length)} />
        <Total label="Billed" text={rm(t.billed)} />
        <Total label="Actual cost" text={rm(t.actual)} note={rows.some(r => r.actualSource !== 'invoice') ? `${rows.filter(r => r.actualSource !== 'invoice').length} not from invoices` : undefined} />
        <Total label="Profit" text={rm(t.profit)} negative={t.profit < 0} />
      </div>
      <DataTable<ProfitRow>
        id={`job-profit.${kind}`} urlPrefix="jp." columns={columns} rows={q.data ? rows : null} rowKey={r => r.id} pageSize={50}
        noun={kind === 'maintenance' ? ['job', 'jobs'] : ['cleaning job', 'cleaning jobs']} exportName={`profit-by-job-${kind}-${month}`} defaultSort="day:asc"
        onRowClick={onOpen ? r => onOpen(r.id) : undefined}
        toolbar={<div className="flex items-center gap-2 flex-wrap">
          <Select label="Month" value={month} onChange={setMonth} options={lastMonths(12).map(m => ({ value: m, label: monthLabel(`${m}-01`) }))} />
          <Select label="Building" value={building} onChange={setBuilding} options={[{ value: '', label: 'Every building' }, ...buildings.map(([id, name]) => ({ value: id, label: name }))]} />
          <Select label={kind === 'maintenance' ? 'Contractor' : 'Cleaner'} value={who} onChange={setWho} options={[{ value: '', label: kind === 'maintenance' ? 'Every contractor' : 'Every cleaner' }, ...people.map(p => ({ value: p, label: p }))]} />
        </div>}
        filtered={!!building || !!who} onClearFilters={() => { setBuilding(''); setWho(''); }}
        empty={{ title: `No ${kind === 'maintenance' ? 'maintenance jobs' : 'cleaning jobs'} finished in ${monthLabel(`${month}-01`)}.`, icon: 'TrendingUp' }}
      />
    </div>
  );
}

function Total({ label, text, note, negative }: { label: string; text: string; note?: string; negative?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-card bg-card border border-solid border-line">
      <span className="text-meta text-muted-ink">{label}</span>
      <b className={cx('text-heading tabular-nums', negative && 'text-danger')}>{text}</b>
      {note && <span className="text-meta text-warning">{note}</span>}
    </div>
  );
}

