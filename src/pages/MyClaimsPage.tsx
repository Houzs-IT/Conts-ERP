import { useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Card, FormSection } from '../components/Card';
import { Button, ButtonLink } from '../components/Button';
import { Field } from '../components/Field';
import { ComboSelect, Select, type SelectOption } from '../components/Select';
import { Segmented, StatTile } from '../components/Metric';
import { ChoiceChips } from '../components/ChoiceChips';
import { KeyFacts } from '../components/KeyFacts';
import { MoneyLines } from '../components/MoneyLines';
import { ListToolbar } from '../components/ListToolbar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StaleBanner } from '../components/DataState';
import Icon from '../components/Icon';
import { TONE, cx } from '../lib/design-tokens';
import { DataTable, type Column } from '../components/DataTable';
import { FileDropRow } from '../components/Attachments';
import { MoneyInput, DateField } from '../components/inputs';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { date, monthLabel, rm, todayMyt, buildingName } from '../lib/format';
import {
  DEPARTMENT, RECEIPT_STATUS, REQUEST_STATUS, postWithFiles, readReceipt, readRequestBill, receiptFileHref, requestBillFill, thisMonthMyt,
  type ClaimLine, type LineDepartment, type Me, type MyFloat, type NewLine, type PaymentRequest, type Receipt,
} from '../lib/claims';

/**
 * My claims (finance, 28-29 Oct 2026; SOP 3.2, 6): a member of staff hands something in and follows it, and, if they
 * keep their department's petty cash, sees the float. One form (chew, 2 Nov 2026; plan 2026-11-02-my-claims-one-form):
 * "Claim to me" for what they paid (paid back from the department's float, or by finance by transfer when there is
 * none), or "Direct pay" for finance to pay a supplier (a payment, or a deposit before the bill). Nobody who hands in
 * chooses the account (finance does, while checking), and a line's department is the person's (the engine sets it).
 * Everything is kept in the engine; this page reaches it through /api/claims (functions/api/claims/[[path]].ts).
 */
type Tab = 'handin' | 'mine' | 'float';
type Kind = 'claim' | 'direct';
type LineDraft = { where: 'none' | 'unit' | 'job' | 'project'; unitId: string; jobId: string; projectId: string; amountSen: number | null; description: string };
type Supplier = { id: string; code: string; name: string };

const blankLine = (): LineDraft => ({ where: 'none', unitId: '', jobId: '', projectId: '', amountSen: null, description: '' });
const lastMonths = (n: number): SelectOption[] => {
  const [y, m] = thisMonthMyt().split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const v = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { value: v, label: monthLabel(`${v}-01`, { long: true }) };
  });
};

export default function MyClaimsPage() {
  const me = useApi<Me>('/claims/me');
  const [tab, setTab] = useState<Tab>('handin');
  const tabs = [
    { key: 'handin' as const, label: 'Hand in' },
    { key: 'mine' as const, label: 'Mine' },
    ...(me.data?.keepsFloat ? [{ key: 'float' as const, label: 'Petty cash I keep' }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My claims" sub="Claim back what you paid, or ask finance to pay a supplier." />
      {me.error && <StaleBanner message={me.error} onRetry={me.reload} />}
      <Segmented label="My claims" options={tabs} value={tab} onChange={setTab} className="self-start" />
      {tab === 'handin' && me.data && <HandInForm me={me.data} onDone={() => setTab('mine')} />}
      {tab === 'mine' && <Mine />}
      {tab === 'float' && <KeptFloat />}
    </div>
  );
}

interface LineTargets {
  unitOptions: SelectOption[];
  jobOptions: SelectOption[];
  projectOptions: SelectOption[];
  describeLine: (line: ClaimLine) => string;
}

/** What a line can be for (units grouped by building, jobs with their unit, projects), and how a saved line reads. */
function useLineTargets(): LineTargets {
  const units = useApi<{ units: { id: string; building: string; unitNumber: string }[] }>('/claims/units');
  const jobs = useApi<{ jobs: { id: string; unitId: string; title: string }[] }>('/claims/jobs');
  const projects = useApi<{ projects: { id: number; code: string | null; name: string }[] }>('/claims/projects');
  return useMemo(() => {
    const unitOptions = (units.data?.units ?? []).map(u => ({ value: u.id, label: `${buildingName(u.building)} ${u.unitNumber}`, group: buildingName(u.building) }));
    const unitLabels = new Map(unitOptions.map(o => [o.value, o.label]));
    const jobOptions = (jobs.data?.jobs ?? []).map(j => ({ value: j.id, label: j.title, hint: unitLabels.get(j.unitId) }));
    const projectOptions = (projects.data?.projects ?? []).map(p => ({ value: String(p.id), label: [p.code, p.name].filter(Boolean).join(' ') }));
    const labelOf = (options: SelectOption[], id: string) => options.find(o => o.value === id)?.label;
    const describeLine = (line: ClaimLine): string => {
      if (line.maintenanceIssueId) return `Maintenance job: ${labelOf(jobOptions, line.maintenanceIssueId) ?? 'closed or not found'}`;
      if (line.unitId) return `Unit ${labelOf(unitOptions, line.unitId) ?? ''}`.trim();
      if (line.projectId != null) return `Project ${labelOf(projectOptions, String(line.projectId)) ?? ''}`.trim();
      return `${DEPARTMENT[line.department]} department`;
    };
    return { unitOptions, jobOptions, projectOptions, describeLine };
  }, [units.data, jobs.data, projects.data]);
}

/** The cost lines: what it was for. The department is the person's (a maintenance job's is Rental); finance sets the account. */
function LinesEditor({ lines, setLines, totalSen, department }: { lines: LineDraft[]; setLines: (l: LineDraft[]) => void; totalSen: number | null; department: LineDepartment }) {
  const { unitOptions, jobOptions, projectOptions } = useLineTargets();
  const set = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const split = lines.length > 1;
  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <div key={i} className={cx('flex flex-col gap-3', i > 0 && 'pt-3 [border-top:1px_dashed_var(--color-line)]')}>
          {split && (
            <div className="flex items-center justify-between gap-2">
              <b className="text-copy">Line {i + 1}</b>
              <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-meta font-semibold text-ink">Department</span>
            <span className="text-copy text-muted-ink">
              {l.where === 'job' ? `${DEPARTMENT.rental} (a maintenance job)` : `${DEPARTMENT[department]} (from your department)`}
            </span>
          </div>
          <ChoiceChips label="For" value={l.where} onChange={v => set(i, { where: v })}
            options={[{ value: 'none', label: 'The department' }, { value: 'unit', label: 'A unit' }, { value: 'job', label: 'A maintenance job' }, { value: 'project', label: 'A project' }]} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            {l.where === 'unit' && <ComboSelect label="Unit" value={l.unitId} onChange={v => set(i, { unitId: v })}
              placeholder="Type a building or unit" options={unitOptions} />}
            {l.where === 'job' && <ComboSelect label="Maintenance job" value={l.jobId} onChange={v => set(i, { jobId: v })}
              placeholder="Type the job or its unit" options={jobOptions} />}
            {l.where === 'project' && <ComboSelect label="Project" value={l.projectId} onChange={v => set(i, { projectId: v })}
              placeholder="Type the project name or code" options={projectOptions} />}
            <Field label="Description" value={l.description} onChange={e => set(i, { description: e.target.value })} placeholder="e.g. tap for the kitchen" maxLength={300} />
            {split && <MoneyInput label="Amount" required valueSen={l.amountSen} onChangeSen={v => set(i, { amountSen: v })} />}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={<Icon name="Plus" size="sm" />} onClick={() => setLines([...lines.map((l, j) => (j === 0 && !split ? { ...l, amountSen: totalSen } : l)), blankLine()])}>Split across more lines</Button>
        {split && totalSen != null && (
          <span className="text-meta text-muted-ink tabular-nums">
            Lines add up to {rm(lines.reduce((n, l) => n + (l.amountSen ?? 0), 0))} of {rm(totalSen)}
          </span>
        )}
      </div>
    </div>
  );
}

/** The lines as the engine takes them (no department, no account: the engine and finance set those); a message when something is missing. */
function toLines(lines: LineDraft[], totalSen: number): { ok: true; lines: NewLine[] } | { ok: false; message: string } {
  const out: NewLine[] = [];
  for (const l of lines) {
    const amountSen = lines.length === 1 ? totalSen : l.amountSen ?? 0;
    if (amountSen <= 0) return { ok: false, message: 'Every line needs an amount.' };
    if (l.where === 'unit' && !l.unitId) return { ok: false, message: 'Choose the unit.' };
    if (l.where === 'job' && !l.jobId) return { ok: false, message: 'Choose the maintenance job.' };
    if (l.where === 'project' && !l.projectId) return { ok: false, message: 'Choose the project.' };
    out.push({
      amountSen, description: l.description.trim() || undefined,
      ...(l.where === 'unit' ? { unitId: l.unitId } : {}), ...(l.where === 'job' ? { maintenanceIssueId: l.jobId } : {}),
      ...(l.where === 'project' ? { projectId: Number(l.projectId) } : {}),
    });
  }
  if (out.reduce((n, l) => n + l.amountSen, 0) !== totalSen) return { ok: false, message: 'The lines must add up to the amount.' };
  return { ok: true, lines: out };
}

/** Every supplier of the company in a table to search, with "Not on the list" first when the payee may be typed. */
function SupplierPicker({ value, onChange, allowNotListed }: { value: Supplier | null; onChange: (s: Supplier | null) => void; allowNotListed: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const all = useApi<{ suppliers: Supplier[] }>(open ? '/claims/suppliers' : null);
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (all.data?.suppliers ?? []).filter(s => words.every(w => `${s.code} ${s.name}`.toLowerCase().includes(w)));
  }, [all.data, q]);
  const pick = (s: Supplier | null) => { onChange(s); setOpen(false); setQ(''); };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-semibold text-ink">Supplier</span>
      <button type="button" onClick={() => setOpen(true)} aria-label="Supplier"
        className="h-[var(--control-height)] min-h-10 flex items-center justify-between gap-2 px-3 rounded-control border border-solid border-line-input bg-card font-sans text-copy text-left text-ink cursor-pointer hover:border-line-strong">
        <span className={cx('truncate', !value && 'text-muted-ink')}>{value ? `${value.code} ${value.name}` : allowNotListed ? 'Choose the supplier, or not on the list' : 'Choose the supplier'}</span>
        <Icon name="ChevronDown" size="sm" />
      </button>
      {open && (
        <Modal title="Choose the supplier" eyebrow="My claims" size="md" onClose={() => setOpen(false)} dirty={false}
          footer={<Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>}>
          <Field label="Search" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or code" autoFocus />
          <div className="mt-3 max-h-[55vh] overflow-auto rounded-control border border-solid border-line-soft">
            {allowNotListed && (
              <button type="button" onClick={() => pick(null)} className="w-full flex items-center justify-between gap-3 min-h-11 px-3 py-2 bg-transparent border-0 [border-bottom:1px_solid_var(--color-line-soft)] font-sans text-left cursor-pointer hover:bg-muted">
                <span className="flex flex-col"><b className="text-copy">Not on the list</b><span className="text-meta text-muted-ink">Type who is paid; finance checks them</span></span>
                <Icon name="ChevronRight" size="sm" />
              </button>
            )}
            {all.loading && <div className="px-3 py-3 text-copy text-muted-ink">Loading suppliers</div>}
            {!all.loading && rows.length === 0 && <div className="px-3 py-3 text-copy text-muted-ink">No supplier matches.</div>}
            {rows.map(s => (
              <button key={s.id} type="button" onClick={() => pick(s)} aria-pressed={value?.id === s.id}
                className={cx('w-full flex items-center gap-3 min-h-10 px-3 py-2 border-0 [border-bottom:1px_solid_var(--color-line-soft)] font-sans text-copy text-left cursor-pointer hover:bg-muted', value?.id === s.id ? 'bg-muted' : 'bg-transparent')}>
                <span className="font-mono text-meta text-muted-ink whitespace-nowrap">{s.code}</span>
                <span className="min-w-0 truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** One form: Claim to me (I paid; pay me back) or Direct pay (finance pays a supplier). What both share stays when switching. */
function HandInForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('claim');
  const [amountSen, setAmountSen] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* Claim to me */
  const [reading, setReading] = useState(false);
  const [spendDate, setSpendDate] = useState(todayMyt());
  const [vendorName, setVendorName] = useState('');
  /* Direct pay */
  const [type, setType] = useState<'PAYMENT' | 'DEPOSIT'>('PAYMENT');
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [poSearch, setPoSearch] = useState('');
  const [po, setPo] = useState<{ id: string; label: string } | null>(null);
  const poId = po?.id ?? '';
  const [payeeName, setPayeeName] = useState('');
  const [wantedOn, setWantedOn] = useState('');
  const pq = poSearch.trim();
  const pos = useApi<{ purchaseOrders: { id: string; poNumber: string; status: string; totalSen: number }[] }>(kind === 'direct' && pq.length >= 2 ? `/claims/purchase-orders?q=${encodeURIComponent(pq)}` : null);

  const found = (pos.data?.purchaseOrders ?? []).map(p => ({ value: p.id, label: `${p.poNumber} · ${rm(p.totalSen)}` }));
  const poOptions = po && !found.some(o => o.value === po.id) ? [{ value: po.id, label: po.label }, ...found] : found;

  /* The receipt and the bill are different papers: switching drops the files; amount, lines and note stay. */
  /* A receipt read still running when the kind is switched (or the files are picked again) must not land: each read
     carries the number it started with, and only the latest one, still on Claim to me, fills anything. */
  const readNo = useRef(0);
  const dateTyped = useRef(false);
  const switchKind = (k: Kind) => { if (k !== kind) { readNo.current++; setReading(false); setKind(k); setFiles([]); setProblem(null); } };
  /* The form as it is NOW, for a bill read that comes back after the person changed it (a PO or supplier picked,
     a payee typed while reading): pick()'s own variables are the values from when the files were chosen. */
  const formNow = useRef({ amountSen, hasSupplierOrPo: false, payeeName, wantedOn, note });
  formNow.current = { amountSen, hasSupplierOrPo: !!supplier || !!poId, payeeName, wantedOn, note };

  async function pick(list: FileList) {
    const chosen = [...files, ...Array.from(list)].slice(0, 8);
    setFiles(chosen);
    if (kind === 'direct') {
      /* The bill fills what is still empty (Houzs payment-request-bill.ts): amount, the supplier it names, pay by,
         what it is for. A read still running when the kind is switched or files are picked again does not land. */
      const mine = ++readNo.current;
      setReading(true);
      const read = await readRequestBill(chosen);
      if (mine !== readNo.current) return;
      setReading(false);
      const fill = requestBillFill(read, { ...formNow.current, today: todayMyt() });
      if (fill.amountSen != null) setAmountSen(a => a ?? fill.amountSen!);
      if (fill.supplier && !formNow.current.hasSupplierOrPo) setSupplier(s => s ?? fill.supplier!);
      if (fill.payeeName) setPayeeName(v => v || fill.payeeName!);
      if (fill.wantedOn) setWantedOn(v => v || fill.wantedOn!);
      if (fill.note) setNote(v => v || fill.note!);
      return;
    }
    const mine = ++readNo.current;
    setReading(true);
    const read = await readReceipt(chosen);
    if (mine !== readNo.current) return;
    setReading(false);
    /* Only what is still empty when the read comes back: a figure typed while it was reading stays. */
    if (read.amountSen != null) setAmountSen(a => a ?? read.amountSen);
    if (read.date && read.date <= todayMyt() && !dateTyped.current) setSpendDate(read.date);
    if (read.vendorName) setVendorName(v => v || read.vendorName || '');
  }

  async function send() {
    setProblem(null);
    if (!amountSen || amountSen <= 0) return setProblem(kind === 'claim' ? 'Enter the amount on the receipt.' : 'Enter the amount.');
    if (kind === 'claim' && files.length === 0) return setProblem('Add a photo of the receipt.');
    if (kind === 'direct') {
      if (!supplier && !poId && (type === 'DEPOSIT' || !payeeName.trim())) return setProblem(type === 'DEPOSIT' ? 'A deposit is paid to a supplier on the list.' : 'Choose the supplier, a PO, or type who is paid.');
      if (files.length === 0) return setProblem('Add the invoice, receipt or quotation.');
    }
    const built = toLines(lines, amountSen);
    if (!built.ok) return setProblem(built.message);
    setBusy(true);
    try {
      if (kind === 'claim') {
        const made = await postWithFiles<{ receiptNo: string; route: 'float' | 'finance' }>('/claims/receipts',
          { spendDate, amountSen, vendorName: vendorName.trim() || undefined, note: note.trim() || undefined, lines: built.lines }, files);
        toast({ tone: 'success', title: `Receipt ${made.receiptNo} handed in`, body: made.route === 'float' ? 'Your department\'s petty cash pays you back.' : 'Finance pays you back by transfer.' });
      } else {
        const made = await postWithFiles<{ requestNo: string }>('/claims/requests', {
          type, supplierId: poId ? undefined : supplier?.id, purchaseOrderId: poId || undefined, payeeName: !poId && !supplier ? payeeName.trim() || undefined : undefined,
          amountSen, wantedOn: wantedOn || undefined, note: note.trim() || undefined, lines: built.lines,
        }, files);
        toast({ tone: 'success', title: `Request ${made.requestNo} sent to finance` });
      }
      onDone();
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  }

  const claim = kind === 'claim';
  const summary = (
    <Card className="p-4 flex flex-col gap-3 lg:sticky lg:top-0">
      <span className="ds-eyebrow">Summary</span>
      <KeyFacts cols={2} items={[
        { label: 'Hand in as', value: claim ? 'Claim to me' : 'Direct pay' },
        { label: 'Lines', value: String(lines.length) },
        { label: 'Amount', value: amountSen ? rm(amountSen) : 'Not entered' },
        { label: claim ? 'Paid back by' : 'Paid by', value: claim ? (me.route === 'float' ? 'Petty cash' : 'Finance, by transfer') : 'Finance, by transfer' },
      ]} />
      <p className="m-0 text-meta text-muted-ink">
        {claim ? (me.route === 'float' ? 'Your department keeps petty cash, so it pays you back once the receipt is checked.' : 'Your department has no petty cash: finance pays you back by bank transfer.')
          : 'Finance pays the supplier after checking the bill and the payee. Finance chooses the account while checking.'}
      </p>
    </Card>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
      <Card className="p-4 sm:p-5 flex flex-col gap-4">
        <FormSection title="What is this" hint={claim ? 'I paid; pay me back' : 'Finance pays a supplier'}>
          <ChoiceChips label="Hand in as" value={kind} onChange={switchKind} options={[{ value: 'claim', label: 'Claim to me' }, { value: 'direct', label: 'Direct pay' }]} />
        </FormSection>
        {claim ? (
          <section className="ds-fs">
            <div className="ds-fs-h"><b>Receipt</b></div>
            <div className="flex flex-col gap-3">
              <FileDropRow label="Add the receipt" hint="Photos or a PDF. The amount is read from it; check it before you send." accept="image/*,application/pdf" multiple
                onPick={l => void pick(l)} busy={reading} chosen={files.length ? files.map(f => f.name).join(', ') : null} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <DateField label="Date on the receipt" required value={spendDate} onChange={v => { setSpendDate(v); dateTyped.current = true; }} max={todayMyt()} />
                <MoneyInput label="Amount" required valueSen={amountSen} onChangeSen={setAmountSen} />
                <Field label="Shop (optional)" value={vendorName} onChange={e => setVendorName(e.target.value)} maxLength={200} />
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="ds-fs">
              <div className="ds-fs-h"><b>Money and papers</b></div>
              <div className="flex flex-col gap-3">
                <FileDropRow label="Add the invoice, receipt or quotation" hint="Photos or a PDF. Empty fields are filled from it; check them before you send." accept="image/*,application/pdf" multiple onPick={l => void pick(l)}
                  busy={reading} chosen={files.length ? files.map(f => f.name).join(', ') : null} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <MoneyInput label="Amount" required valueSen={amountSen} onChangeSen={setAmountSen} />
                  <DateField label="Pay by (optional)" value={wantedOn} onChange={setWantedOn} min={todayMyt()} />
                </div>
              </div>
            </section>
            <section className="ds-fs">
              <div className="ds-fs-h"><b>Who is paid</b></div>
              <div className="flex flex-col gap-3">
                <ChoiceChips label="What to pay" value={type} onChange={setType} options={[{ value: 'PAYMENT', label: 'A payment' }, { value: 'DEPOSIT', label: 'A deposit' }]}
                  help={type === 'PAYMENT' ? 'A bill to pay: an invoice or a receipt from the supplier.' : 'Paid before the bill, to a supplier on the list; their bill later is set off against it.'} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <Field label="Find a PO (optional)" value={poSearch} onChange={e => setPoSearch(e.target.value)} placeholder="PO number" />
                  {/* The chosen PO stays an option when a new search no longer finds it, so the box never shows "Not against a
                      PO" while one is still chosen. */}
                  <Select label="Purchase order" showLabel value={poId} onChange={v => { const o = poOptions.find(x => x.value === v); setPo(o ? { id: o.value, label: o.label } : null); if (o) setSupplier(null); }}
                    options={[{ value: '', label: 'Not against a PO' }, ...poOptions]} />
                  {!poId && <SupplierPicker value={supplier} onChange={setSupplier} allowNotListed={type === 'PAYMENT'} />}
                  {!poId && !supplier && type === 'PAYMENT' && <Field label="Pay to (not on the list)" value={payeeName} onChange={e => setPayeeName(e.target.value)} maxLength={200} help="Finance checks the payee before paying." />}
                </div>
              </div>
            </section>
          </>
        )}
        <section className="ds-fs">
          <div className="ds-fs-h"><b>What it was for</b><span>{lines.length > 1 ? 'The lines must add up to the amount' : 'Finance chooses the account while checking'}</span></div>
          <LinesEditor lines={lines} setLines={setLines} totalSen={amountSen} department={me.lineDepartment} />
        </section>
        <section className="ds-fs">
          <div className="ds-fs-h"><b>Note</b></div>
          <Field label="Anything finance should know (optional)" value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
        </section>
        {problem && <div role="alert" className={cx('px-3 py-2 rounded-control text-copy', TONE.critical.bg, TONE.critical.text)}>{problem}</div>}
        <div className="flex justify-end max-sm:[&>*]:w-full">
          <Button variant="primary" loading={busy} disabled={reading} disabledReason="Reading the papers first." onClick={() => void send()}>{claim ? 'Hand in' : 'Send to finance'}</Button>
        </div>
      </Card>
      <div className="max-lg:order-first max-lg:hidden">{summary}</div>
    </div>
  );
}

function Files({ r }: { r: Receipt }) {
  if (!r.files.length) return <>—</>;
  return <>{r.files.map((f, i) => <a key={f.id} href={receiptFileHref(r.id, f.id)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="mr-2 text-primary font-medium">{f.mime === 'application/pdf' ? 'PDF' : 'Photo'}{r.files.length > 1 ? ` ${i + 1}` : ''}</a>)}</>;
}

const canWithdraw = (q: PaymentRequest) => q.status === 'SUBMITTED' && q.vouchers.length === 0;

function TableTitle({ title, count }: { title: string; count?: number }) {
  return (
    <span className="flex items-baseline gap-2 min-w-0 mr-1">
      <span className="text-[16px] font-semibold tracking-[-0.01em] truncate">{title}</span>
      {count !== undefined && <span className="text-meta text-muted-ink tabular-nums">{count}</span>}
    </span>
  );
}

function MonthToolbar({ title, count, month, onMonthChange }: { title: string; count?: number; month: string; onMonthChange: (month: string) => void }) {
  const months = useMemo(() => lastMonths(12), []);
  return (
    <ListToolbar bare className="w-full" leading={<TableTitle title={title} count={count} />}
      date={{ label: 'Month', value: month, onChange: onMonthChange, presets: months.map(m => ({ value: m.value, label: String(m.label) })) }} />
  );
}

type DescribeLine = LineTargets['describeLine'];

function DetailLines({ lines, totalSen, describeLine }: { lines: ClaimLine[]; totalSen: number; describeLine: DescribeLine }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="ds-eyebrow">What it was for</span>
      <MoneyLines lines={[
        ...lines.map(l => ({ label: [describeLine(l), l.description].filter(Boolean).join(' · '), sen: l.amountSen })),
        ...(lines.length > 1 ? [{ label: 'Total', sen: totalSen, kind: 'total' as const }] : []),
      ]} />
    </section>
  );
}

function Problem({ text }: { text: string }) {
  return <div role="note" className={cx('px-3 py-2 rounded-control text-copy', TONE.critical.bg, TONE.critical.text)}>{text}</div>;
}

/** One receipt in full, for looking back at it: what was paid, what for, how it is paid back, and the photos. */
function ReceiptDetail({ receipt, describeLine, onClose }: { receipt: Receipt; describeLine: DescribeLine; onClose: () => void }) {
  return (
    <Modal title={`Receipt ${receipt.receiptNo}`} eyebrow="My claims" size="md" onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <KeyFacts cols={2} items={[
        { label: 'Amount', value: rm(receipt.amountSen) },
        { label: 'Status', value: RECEIPT_STATUS[receipt.status] },
        { label: 'Date on the receipt', value: date(receipt.spendDate) },
        { label: 'Shop', value: receipt.vendorName ?? '—' },
        { label: 'Paid back by', value: receipt.floatId ? 'Petty cash' : 'Finance, by transfer' },
      ]} />
      {receipt.rejectReason && <Problem text={receipt.rejectReason} />}
      <DetailLines lines={receipt.lines} totalSen={receipt.amountSen} describeLine={describeLine} />
      {receipt.note && <KeyFacts cols={1} items={[{ label: 'Note', value: receipt.note }]} />}
      {receipt.files.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="ds-eyebrow">Papers</span>
          <div className="flex flex-wrap gap-2">
            {receipt.files.map(f => (
              <ButtonLink key={f.id} href={receiptFileHref(receipt.id, f.id)} target="_blank" rel="noreferrer" size="sm"
                icon={<Icon name={f.mime === 'application/pdf' ? 'FileText' : 'Image'} size="sm" />}>{f.fileName}</ButtonLink>
            ))}
          </div>
        </section>
      )}
    </Modal>
  );
}

/** One request to finance in full; while finance has not started paying it, it can be withdrawn from here. */
function RequestDetail({ request, describeLine, onClose, onWithdraw }: { request: PaymentRequest; describeLine: DescribeLine; onClose: () => void; onWithdraw: () => void }) {
  const vouchers = request.vouchers.filter(v => v.status !== 'CANCELLED').map(v => v.pvNumber).join(', ');
  return (
    <Modal title={`Request ${request.requestNo}`} eyebrow="My claims" size="md" onClose={onClose}
      footer={<>
        {canWithdraw(request) && <Button variant="secondary" icon={<Icon name="Undo2" size="sm" />} onClick={onWithdraw}>Withdraw</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      <KeyFacts cols={2} items={[
        { label: 'Amount', value: rm(request.amountSen) },
        { label: 'Status', value: REQUEST_STATUS[request.status] },
        { label: 'Pay', value: request.payeeName },
        { label: 'What', value: request.type === 'DEPOSIT' ? 'A deposit' : 'A payment' },
        { label: 'Asked on', value: date(request.createdAt.slice(0, 10)) },
        { label: 'Pay by', value: request.wantedOn ? date(request.wantedOn) : 'Not set' },
        ...(vouchers ? [{ label: 'Payment voucher', value: vouchers }] : []),
      ]} />
      {request.reason && <Problem text={request.reason} />}
      <DetailLines lines={request.lines} totalSen={request.amountSen} describeLine={describeLine} />
      {canWithdraw(request) && <p className="m-0 text-meta text-muted-ink">Finance has not started paying it, so you can still withdraw it.</p>}
    </Modal>
  );
}

function Mine() {
  const [month, setMonth] = useState(thisMonthMyt());
  const receipts = useApi<{ receipts: Receipt[] }>(`/claims/receipts?month=${month}`);
  const requests = useApi<{ requests: PaymentRequest[] }>('/claims/requests');
  const toast = useToast();
  const [withdraw, setWithdraw] = useState<PaymentRequest | null>(null);
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);
  const [openRequest, setOpenRequest] = useState<PaymentRequest | null>(null);
  const { describeLine } = useLineTargets();
  const rCols: Column<Receipt>[] = [
    { key: 'date', label: 'Date', type: 'date', value: r => r.spendDate },
    { key: 'no', label: 'Receipt', value: r => r.receiptNo },
    { key: 'shop', label: 'Shop', value: r => r.vendorName ?? '', sub: r => r.lines.map(l => l.description).filter(Boolean).join('; ') },
    { key: 'amount', label: 'Amount', type: 'money', value: r => r.amountSen },
    { key: 'status', label: 'Status', value: r => RECEIPT_STATUS[r.status], sub: r => r.rejectReason ?? (r.floatId ? 'Paid from petty cash' : 'Paid back by finance') },
    { key: 'files', label: 'Receipt', value: r => r.files.length, render: r => <Files r={r} /> },
  ];
  const qCols: Column<PaymentRequest>[] = [
    { key: 'on', label: 'Asked on', type: 'date', value: q => q.createdAt.slice(0, 10) },
    { key: 'no', label: 'Request', value: q => q.requestNo },
    { key: 'pay', label: 'Pay', value: q => q.payeeName, sub: q => (q.type === 'DEPOSIT' ? 'Deposit' : null) },
    { key: 'amount', label: 'Amount', type: 'money', value: q => q.amountSen },
    { key: 'status', label: 'Status', value: q => REQUEST_STATUS[q.status], sub: q => q.reason ?? q.vouchers.filter(v => v.status !== 'CANCELLED').map(v => v.pvNumber).join(', ') },
    {
      key: 'act', label: '', value: () => '', phone: 'hide', noExport: true,
      render: q => (canWithdraw(q) ? (
        <Button variant="secondary" size="sm" icon={<Icon name="Undo2" size="sm" />} onClick={e => { e.stopPropagation(); setWithdraw(q); }}>Withdraw</Button>
      ) : null),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <DataTable id="my-claims-receipts" toolbar={<MonthToolbar title="My receipts" count={receipts.data?.receipts.length} month={month} onMonthChange={setMonth} />} columns={rCols} rows={receipts.data?.receipts ?? null} rowKey={r => r.id} loading={receipts.loading} error={receipts.error} onRetry={receipts.reload}
        onRowClick={setOpenReceipt} empty={{ title: 'No receipts this month' }} />
      <DataTable id="my-claims-requests" toolbar={<TableTitle title="Asked finance to pay" count={requests.data?.requests.length} />} columns={qCols} rows={requests.data?.requests ?? null} rowKey={q => q.id} loading={requests.loading} error={requests.error} onRetry={requests.reload}
        onRowClick={setOpenRequest} empty={{ title: 'Nothing asked yet' }} />
      {openReceipt && <ReceiptDetail receipt={openReceipt} describeLine={describeLine} onClose={() => setOpenReceipt(null)} />}
      {openRequest && <RequestDetail request={openRequest} describeLine={describeLine} onClose={() => setOpenRequest(null)}
        onWithdraw={() => { setWithdraw(openRequest); setOpenRequest(null); }} />}
      <ConfirmDialog busy={false} onClose={() => setWithdraw(null)} spec={withdraw && {
        title: `Withdraw ${withdraw.requestNo}?`,
        body: 'Finance has not paid it yet. Withdrawing removes it from their list; you can ask again later.',
        confirmLabel: 'Withdraw request', danger: true,
        onConfirm: async () => {
          const q = withdraw; setWithdraw(null);
          try { await api.post(`/claims/requests/${q.id}/withdraw`, {}); toast({ tone: 'success', title: `${q.requestNo} withdrawn` }); requests.reload(); }
          catch (e) { toast({ tone: 'critical', title: 'Not withdrawn', body: errorMessage(e) }); }
        },
      }} />
    </div>
  );
}

function KeptFloat() {
  const [month, setMonth] = useState(thisMonthMyt());
  const q = useApi<MyFloat>(`/claims/float?month=${month}`);
  const toast = useToast();
  const f = q.data?.float;
  const cols: Column<Receipt>[] = [
    { key: 'date', label: 'Date', type: 'date', value: r => r.spendDate },
    { key: 'by', label: 'Handed in by', value: r => r.submitterName },
    { key: 'shop', label: 'Shop', value: r => r.vendorName ?? '', sub: r => r.lines.map(l => l.description).filter(Boolean).join('; ') },
    { key: 'amount', label: 'Amount', type: 'money', value: r => r.amountSen },
    { key: 'status', label: 'Status', value: r => RECEIPT_STATUS[r.status], sub: r => r.rejectReason },
    { key: 'files', label: 'Receipt', value: r => r.files.length, render: r => <Files r={r} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      {f && (
        <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
          <StatTile hero className="col-span-2 lg:col-span-1" label="Cash you should hold" value={rm(f.balanceSen)}
            hint={f.balanceSen < 0 ? 'Below zero: you have paid in your own money; the next top-up pays it back.' : f.low ? 'Running low.' : f.lastTopUpOn ? `Last topped up ${date(f.lastTopUpOn)}.` : 'Not topped up yet.'} />
          <StatTile label="Float" value={rm(f.floatSen)} hint="What the department keeps" />
          <Card className="col-span-2 lg:col-span-1 p-4 flex flex-col justify-between gap-3">
            <span className="text-meta text-muted-ink">When the cash runs low, ask finance to top the float back up.</span>
            <div><Button variant="secondary" size="sm" disabled={f.topUpRequested} disabledReason="Finance has been asked already." onClick={async () => {
              try { await api.post('/claims/float/top-up-request', {}); toast({ tone: 'success', title: 'Finance has been asked for a top-up' }); q.reload(); }
              catch (e) { toast({ tone: 'critical', title: 'Not sent', body: errorMessage(e) }); }
            }}>{f.topUpRequested ? 'Top-up asked for' : 'Ask for a top-up'}</Button></div>
          </Card>
        </div>
      )}
      <DataTable id="my-claims-float" toolbar={<MonthToolbar title="Receipts on the float" count={q.data?.receipts.length} month={month} onMonthChange={setMonth} />} columns={cols} rows={q.data?.receipts ?? null} rowKey={r => r.id} loading={q.loading} error={q.error} onRetry={q.reload}
        empty={{ title: 'No receipts this month' }} />
    </div>
  );
}
