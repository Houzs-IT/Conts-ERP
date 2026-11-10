import { useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Select, type SelectOption } from '../components/Select';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { FileDropRow } from '../components/Attachments';
import { MoneyText } from '../components/MoneyText';
import { MoneyInput, DateField } from '../components/inputs';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { monthLabel, rm, todayMyt } from '../lib/format';
import {
  DEPARTMENT, RECEIPT_STATUS, REQUEST_STATUS, postWithFiles, readReceipt, readRequestBill, receiptFileHref, requestBillFill, thisMonthMyt,
  type LineDepartment, type Me, type MyFloat, type NewLine, type PaymentRequest, type Receipt,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="My claims" sub="Claim back what you paid, or ask finance to pay a supplier." />
      {me.error && <Card style={{ padding: 16 }}>{me.error}</Card>}
      <Segmented label="My claims" options={tabs} value={tab} onChange={setTab} />
      {tab === 'handin' && me.data && <HandInForm me={me.data} onDone={() => setTab('mine')} />}
      {tab === 'mine' && <Mine />}
      {tab === 'float' && <KeptFloat />}
    </div>
  );
}

/** The cost lines: what it was for. The department is the person's (a maintenance job's is Rental); finance sets the account. */
function LinesEditor({ lines, setLines, totalSen, department }: { lines: LineDraft[]; setLines: (l: LineDraft[]) => void; totalSen: number | null; department: LineDepartment }) {
  const units = useApi<{ units: { id: string; building: string; unitNumber: string }[] }>('/claims/units');
  const jobs = useApi<{ jobs: { id: string; unitId: string; title: string }[] }>('/claims/jobs');
  const projects = useApi<{ projects: { id: number; code: string | null; name: string }[] }>('/claims/projects');
  const set = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const split = lines.length > 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end', paddingTop: i ? 12 : 0, borderTop: i ? '1px solid var(--color-border-muted)' : undefined }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--text-small)', fontWeight: 600 }}>Department</span>
            <span style={{ padding: '8px 0', color: 'var(--color-text-muted)' }}>
              {l.where === 'job' ? `${DEPARTMENT.rental} (a maintenance job)` : `${DEPARTMENT[department]} (from your department)`}
            </span>
          </div>
          <Select label="For" showLabel value={l.where} onChange={v => set(i, { where: v as LineDraft['where'] })}
            options={[{ value: 'none', label: 'The department' }, { value: 'unit', label: 'A unit' }, { value: 'job', label: 'A maintenance job' }, { value: 'project', label: 'A project' }]} />
          {l.where === 'unit' && <Select label="Unit" showLabel value={l.unitId} onChange={v => set(i, { unitId: v })} placeholder="Choose the unit"
            options={(units.data?.units ?? []).map(u => ({ value: u.id, label: `${u.building} ${u.unitNumber}` }))} />}
          {l.where === 'job' && <Select label="Maintenance job" showLabel value={l.jobId} onChange={v => set(i, { jobId: v })} placeholder="Choose the job"
            options={(jobs.data?.jobs ?? []).map(j => ({ value: j.id, label: j.title }))} />}
          {l.where === 'project' && <Select label="Project" showLabel value={l.projectId} onChange={v => set(i, { projectId: v })} placeholder="Choose the project"
            options={(projects.data?.projects ?? []).map(p => ({ value: String(p.id), label: [p.code, p.name].filter(Boolean).join(' ') }))} />}
          <Field label="Description" value={l.description} onChange={e => set(i, { description: e.target.value })} placeholder="e.g. tap for the kitchen" maxLength={300} />
          {split && <MoneyInput label="Amount" valueSen={l.amountSen} onChangeSen={v => set(i, { amountSen: v })} />}
          {split && <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button variant="ghost" onClick={() => setLines([...lines.map((l, j) => (j === 0 && !split ? { ...l, amountSen: totalSen } : l)), blankLine()])}>Split across more lines</Button>
        {split && totalSen != null && (
          <span style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
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
  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--color-border-muted)', textAlign: 'left', cursor: 'pointer' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--text-small)', fontWeight: 600 }}>Supplier</span>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-label="Supplier">
        {value ? `${value.code} ${value.name}` : allowNotListed ? 'Choose the supplier, or not on the list…' : 'Choose the supplier…'}
      </Button>
      {open && (
        <Modal title="Choose the supplier" onClose={() => setOpen(false)} width={640} dirty={false} footer={<Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>}>
          <Field label="Search" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or code" autoFocus />
          <div style={{ maxHeight: '55vh', overflow: 'auto', marginTop: 12, border: '1px solid var(--color-border-muted)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...cell, cursor: 'default' }}>Code</th><th style={{ ...cell, cursor: 'default' }}>Name</th></tr></thead>
              <tbody>
                {allowNotListed && (
                  <tr onClick={() => pick(null)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') pick(null); }}>
                    <td style={cell} colSpan={2}><b>Not on the list</b> <span style={{ color: 'var(--color-text-muted)' }}>— type who is paid; finance checks them</span></td>
                  </tr>
                )}
                {all.loading && <tr><td style={cell} colSpan={2}>Loading…</td></tr>}
                {!all.loading && rows.length === 0 && <tr><td style={cell} colSpan={2}>No supplier matches.</td></tr>}
                {rows.map(s => (
                  <tr key={s.id} onClick={() => pick(s)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') pick(s); }}
                    style={{ background: value?.id === s.id ? 'var(--color-surface-muted)' : undefined }}>
                    <td style={{ ...cell, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{s.code}</td>
                    <td style={cell}>{s.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      const fill = requestBillFill(read, { amountSen, hasSupplierOrPo: !!supplier || !!poId, payeeName, wantedOn, note, today: todayMyt() });
      if (fill.amountSen != null) setAmountSen(a => a ?? fill.amountSen!);
      if (fill.supplier) setSupplier(s => s ?? fill.supplier!);
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

  return (
    <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Segmented label="What is this?" options={[{ key: 'claim' as const, label: 'Claim to me' }, { key: 'direct' as const, label: 'Direct pay' }]} value={kind} onChange={switchKind} />
      {kind === 'claim' ? (
        <>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            I paid. {me.route === 'float' ? 'Your department\'s petty cash pays you back.' : 'Your department has no petty cash: finance pays you back by bank transfer.'}
          </p>
          <FileDropRow label="Add the receipt" hint="Photos or a PDF. The amount is read from it; check it before you send." accept="image/*,application/pdf" multiple
            onPick={l => void pick(l)} busy={reading} chosen={files.length ? files.map(f => f.name).join(', ') : null} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <DateField label="Date on the receipt" value={spendDate} onChange={v => { setSpendDate(v); dateTyped.current = true; }} max={todayMyt()} />
            <MoneyInput label="Amount" valueSen={amountSen} onChangeSen={setAmountSen} />
            <Field label="Shop (optional)" value={vendorName} onChange={e => setVendorName(e.target.value)} maxLength={200} />
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Finance pays a supplier.</p>
          <Segmented label="What to pay" options={[{ key: 'PAYMENT' as const, label: 'A payment' }, { key: 'DEPOSIT' as const, label: 'A deposit' }]} value={type} onChange={setType} />
          <span style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
            {type === 'PAYMENT' ? 'A bill to pay: an invoice or a receipt from the supplier.' : 'Paid before the bill, to a supplier on the list; their bill later is set off against it.'}
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
            <Field label="Find a PO (optional)" value={poSearch} onChange={e => setPoSearch(e.target.value)} placeholder="PO number" />
            {/* The chosen PO stays an option when a new search no longer finds it, so the box never shows "Not against a
                PO" while one is still chosen. */}
            <Select label="Purchase order" showLabel value={poId} onChange={v => { const o = poOptions.find(x => x.value === v); setPo(o ? { id: o.value, label: o.label } : null); if (o) setSupplier(null); }}
              options={[{ value: '', label: 'Not against a PO' }, ...poOptions]} />
            {!poId && <SupplierPicker value={supplier} onChange={setSupplier} allowNotListed={type === 'PAYMENT'} />}
            {!poId && !supplier && type === 'PAYMENT' && <Field label="Pay to (not on the list)" value={payeeName} onChange={e => setPayeeName(e.target.value)} maxLength={200} help="Finance checks the payee before paying." />}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <MoneyInput label="Amount" valueSen={amountSen} onChangeSen={setAmountSen} />
            <DateField label="Pay by (optional)" value={wantedOn} onChange={setWantedOn} min={todayMyt()} />
          </div>
          <FileDropRow label="Add the invoice, receipt or quotation" hint="Photos or a PDF. Empty fields are filled from it; check them before you send." accept="image/*,application/pdf" multiple onPick={l => void pick(l)}
            busy={reading} chosen={files.length ? files.map(f => f.name).join(', ') : null} />
        </>
      )}
      <LinesEditor lines={lines} setLines={setLines} totalSen={amountSen} department={me.lineDepartment} />
      <Field label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Anything finance should know" />
      {problem && <div role="alert" style={{ color: 'var(--color-critical-fg)' }}>{problem}</div>}
      <div><Button disabled={busy || reading} onClick={() => void send()}>{busy ? 'Sending…' : kind === 'claim' ? 'Hand in' : 'Send to finance'}</Button></div>
    </Card>
  );
}

function Files({ r }: { r: Receipt }) {
  if (!r.files.length) return <>—</>;
  return <>{r.files.map((f, i) => <a key={f.id} href={receiptFileHref(r.id, f.id)} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{f.mime === 'application/pdf' ? 'PDF' : 'Photo'}{r.files.length > 1 ? ` ${i + 1}` : ''}</a>)}</>;
}

function Mine() {
  const [month, setMonth] = useState(thisMonthMyt());
  const receipts = useApi<{ receipts: Receipt[] }>(`/claims/receipts?month=${month}`);
  const requests = useApi<{ requests: PaymentRequest[] }>('/claims/requests');
  const toast = useToast();
  const months = useMemo(() => lastMonths(12), []);
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
      key: 'act', label: '', value: () => '',
      render: q => (q.status === 'SUBMITTED' && q.vouchers.length === 0 ? (
        <Button variant="ghost" onClick={async () => {
          try { await api.post(`/claims/requests/${q.id}/withdraw`, {}); toast({ tone: 'success', title: `${q.requestNo} withdrawn` }); requests.reload(); }
          catch (e) { toast({ tone: 'critical', title: 'Not withdrawn', body: errorMessage(e) }); }
        }}>Withdraw</Button>
      ) : null),
    },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ maxWidth: 240 }}><Select label="Month" showLabel value={month} onChange={setMonth} options={months} /></div>
      <DataTable id="my-claims-receipts" header="My receipts" columns={rCols} rows={receipts.data?.receipts ?? null} rowKey={r => r.id} loading={receipts.loading} error={receipts.error} onRetry={receipts.reload}
        empty={{ title: 'No receipts this month' }} />
      <DataTable id="my-claims-requests" header="Asked finance to pay" columns={qCols} rows={requests.data?.requests ?? null} rowKey={q => q.id} loading={requests.loading} error={requests.error} onRetry={requests.reload}
        empty={{ title: 'Nothing asked yet' }} />
    </div>
  );
}

function KeptFloat() {
  const [month, setMonth] = useState(thisMonthMyt());
  const q = useApi<MyFloat>(`/claims/float?month=${month}`);
  const toast = useToast();
  const months = useMemo(() => lastMonths(12), []);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {f && (
        <Card style={{ padding: 20, display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-small)' }}>Cash you should hold</div><MoneyText sen={f.balanceSen} mode="exact" strong style={{ fontSize: 28 }} /></div>
          <div><div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-small)' }}>Float</div><MoneyText sen={f.floatSen} mode="exact" /></div>
          <div style={{ color: f.balanceSen < 0 || f.low ? 'var(--color-critical-fg)' : 'var(--color-text-muted)', fontSize: 'var(--text-small)' }}>
            {f.balanceSen < 0 ? 'Below zero: you have paid in your own money; the next top-up pays it back.' : f.low ? 'Running low.' : f.lastTopUpOn ? `Last topped up ${f.lastTopUpOn}.` : 'Not topped up yet.'}
          </div>
          <Button variant="secondary" disabled={f.topUpRequested} onClick={async () => {
            try { await api.post('/claims/float/top-up-request', {}); toast({ tone: 'success', title: 'Finance has been asked for a top-up' }); q.reload(); }
            catch (e) { toast({ tone: 'critical', title: 'Not sent', body: errorMessage(e) }); }
          }}>{f.topUpRequested ? 'Top-up asked for' : 'Ask for a top-up'}</Button>
        </Card>
      )}
      <div style={{ maxWidth: 240 }}><Select label="Month" showLabel value={month} onChange={setMonth} options={months} /></div>
      <DataTable id="my-claims-float" header="Receipts on the float" columns={cols} rows={q.data?.receipts ?? null} rowKey={r => r.id} loading={q.loading} error={q.error} onRetry={q.reload}
        empty={{ title: 'No receipts this month' }} />
    </div>
  );
}
