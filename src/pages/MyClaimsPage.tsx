import { useMemo, useState } from 'react';
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
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { monthLabel, rm, todayMyt } from '../lib/format';
import {
  DEPARTMENT, RECEIPT_STATUS, REQUEST_STATUS, postWithFiles, readReceipt, receiptFileHref, thisMonthMyt,
  type LineDepartment, type Me, type MyFloat, type NewLine, type PaymentRequest, type Receipt,
} from '../lib/claims';

/**
 * My claims (finance, 28-29 Oct 2026; SOP 3.2, 6): a member of staff hands in a receipt for something they paid, asks
 * finance to pay a supplier, follows both, and, if they keep their department's petty cash, sees the float.
 * A receipt is paid back from the person's department's float, or by finance by transfer when the department has none.
 * Everything is kept in the engine; this page reaches it through /api/claims (functions/api/claims/[[path]].ts).
 */
type Tab = 'receipt' | 'request' | 'mine' | 'float';
type LineDraft = { department: LineDepartment; where: 'none' | 'unit' | 'job' | 'project'; unitId: string; jobId: string; projectId: string; accountCode: string; amountSen: number | null; description: string };

const blankLine = (department: LineDepartment): LineDraft => ({ department, where: 'none', unitId: '', jobId: '', projectId: '', accountCode: '', amountSen: null, description: '' });
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
  const [tab, setTab] = useState<Tab>('receipt');
  const tabs = [
    { key: 'receipt' as const, label: 'Hand in a receipt' },
    { key: 'request' as const, label: 'Ask finance to pay' },
    { key: 'mine' as const, label: 'Mine' },
    ...(me.data?.keepsFloat ? [{ key: 'float' as const, label: 'Petty cash I keep' }] : []),
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="My claims" sub="Hand in receipts for what you paid, and ask finance to pay suppliers." />
      {me.error && <Card style={{ padding: 16 }}>{me.error}</Card>}
      <Segmented label="My claims" options={tabs} value={tab} onChange={setTab} />
      {tab === 'receipt' && me.data && <ReceiptForm me={me.data} onDone={() => setTab('mine')} />}
      {tab === 'request' && me.data && <RequestForm me={me.data} onDone={() => setTab('mine')} />}
      {tab === 'mine' && <Mine />}
      {tab === 'float' && <KeptFloat />}
    </div>
  );
}

/** The cost lines of a receipt or request: what it was for, and where it belongs. */
function LinesEditor({ lines, setLines, totalSen }: { lines: LineDraft[]; setLines: (l: LineDraft[]) => void; totalSen: number | null }) {
  const units = useApi<{ units: { id: string; building: string; unitNumber: string }[] }>('/claims/units');
  const jobs = useApi<{ jobs: { id: string; unitId: string; title: string }[] }>('/claims/jobs');
  const projects = useApi<{ projects: { id: number; code: string | null; name: string }[] }>('/claims/projects');
  const accounts = useApi<{ accounts: { code: string; name: string }[] }>('/claims/accounts');
  const set = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const split = lines.length > 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end', paddingTop: i ? 12 : 0, borderTop: i ? '1px solid var(--color-border-muted)' : undefined }}>
          <Select label="Department" showLabel value={l.department} onChange={v => set(i, { department: v as LineDepartment })}
            options={(['rental', 'supply', 'shared'] as LineDepartment[]).map(d => ({ value: d, label: DEPARTMENT[d] }))} />
          <Select label="For" showLabel value={l.where} onChange={v => set(i, { where: v as LineDraft['where'] })}
            options={[{ value: 'none', label: 'The department' }, { value: 'unit', label: 'A unit' }, { value: 'job', label: 'A maintenance job' }, { value: 'project', label: 'A project' }]} />
          {l.where === 'unit' && <Select label="Unit" showLabel value={l.unitId} onChange={v => set(i, { unitId: v })} placeholder="Choose the unit"
            options={(units.data?.units ?? []).map(u => ({ value: u.id, label: `${u.building} ${u.unitNumber}` }))} />}
          {l.where === 'job' && <Select label="Maintenance job" showLabel value={l.jobId} onChange={v => set(i, { jobId: v })} placeholder="Choose the job"
            options={(jobs.data?.jobs ?? []).map(j => ({ value: j.id, label: j.title }))} />}
          {l.where === 'project' && <Select label="Project" showLabel value={l.projectId} onChange={v => set(i, { projectId: v })} placeholder="Choose the project"
            options={(projects.data?.projects ?? []).map(p => ({ value: String(p.id), label: [p.code, p.name].filter(Boolean).join(' ') }))} />}
          <Select label="What it is" showLabel value={l.accountCode} onChange={v => set(i, { accountCode: v })} placeholder="Choose the kind of cost"
            options={(accounts.data?.accounts ?? []).map(a => ({ value: a.code, label: a.name }))} />
          <Field label="Description" value={l.description} onChange={e => set(i, { description: e.target.value })} placeholder="e.g. tap for the kitchen" maxLength={300} />
          {split && <MoneyInput label="Amount" valueSen={l.amountSen} onChangeSen={v => set(i, { amountSen: v })} />}
          {split && <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button variant="ghost" onClick={() => setLines([...lines.map((l, j) => (j === 0 && !split ? { ...l, amountSen: totalSen } : l)), blankLine(lines[0].department)])}>Split across more lines</Button>
        {split && totalSen != null && (
          <span style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
            Lines add up to {rm(lines.reduce((n, l) => n + (l.amountSen ?? 0), 0))} of {rm(totalSen)}
          </span>
        )}
      </div>
    </div>
  );
}

/** The lines as the engine takes them; null with a message when something is missing. */
function toLines(lines: LineDraft[], totalSen: number): { ok: true; lines: NewLine[] } | { ok: false; message: string } {
  const out: NewLine[] = [];
  for (const l of lines) {
    const amountSen = lines.length === 1 ? totalSen : l.amountSen ?? 0;
    if (amountSen <= 0) return { ok: false, message: 'Every line needs an amount.' };
    if (l.where === 'unit' && !l.unitId) return { ok: false, message: 'Choose the unit.' };
    if (l.where === 'job' && !l.jobId) return { ok: false, message: 'Choose the maintenance job.' };
    if (l.where === 'project' && !l.projectId) return { ok: false, message: 'Choose the project.' };
    out.push({
      department: l.department, amountSen, description: l.description.trim() || undefined, accountCode: l.accountCode || undefined,
      ...(l.where === 'unit' ? { unitId: l.unitId } : {}), ...(l.where === 'job' ? { maintenanceIssueId: l.jobId } : {}),
      ...(l.where === 'project' ? { projectId: Number(l.projectId) } : {}),
    });
  }
  if (out.reduce((n, l) => n + l.amountSen, 0) !== totalSen) return { ok: false, message: 'The lines must add up to the amount.' };
  return { ok: true, lines: out };
}

function ReceiptForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [spendDate, setSpendDate] = useState(todayMyt());
  const [amountSen, setAmountSen] = useState<number | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine(me.lineDepartment)]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(list: FileList) {
    const chosen = [...files, ...Array.from(list)].slice(0, 8);
    setFiles(chosen);
    setReading(true);
    const read = await readReceipt(chosen);
    setReading(false);
    if (read.amountSen != null && amountSen == null) setAmountSen(read.amountSen);
    if (read.date) setSpendDate(read.date);
    if (read.vendorName && !vendorName) setVendorName(read.vendorName);
  }
  async function send() {
    setProblem(null);
    if (files.length === 0) return setProblem('Add a photo of the receipt.');
    if (!amountSen || amountSen <= 0) return setProblem('Enter the amount on the receipt.');
    const built = toLines(lines, amountSen);
    if (!built.ok) return setProblem(built.message);
    setBusy(true);
    try {
      const made = await postWithFiles<{ receiptNo: string; route: 'float' | 'finance' }>('/claims/receipts',
        { spendDate, amountSen, vendorName: vendorName.trim() || undefined, note: note.trim() || undefined, lines: built.lines }, files);
      toast({ tone: 'success', title: `Receipt ${made.receiptNo} handed in`, body: made.route === 'float' ? 'Your department\'s petty cash pays you back.' : 'Finance pays you back by transfer.' });
      onDone();
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        {me.route === 'float' ? 'Your department\'s petty cash pays you back for this.' : 'Your department has no petty cash: finance pays you back by bank transfer.'}
      </p>
      <FileDropRow label="Add the receipt" hint="Photos or a PDF. The amount is read from it; check it before you send." accept="image/*,application/pdf" multiple
        onPick={l => void pick(l)} busy={reading} chosen={files.length ? files.map(f => f.name).join(', ') : null} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <DateField label="Date on the receipt" value={spendDate} onChange={setSpendDate} max={todayMyt()} />
        <MoneyInput label="Amount" valueSen={amountSen} onChangeSen={setAmountSen} />
        <Field label="Shop" value={vendorName} onChange={e => setVendorName(e.target.value)} maxLength={200} />
      </div>
      <LinesEditor lines={lines} setLines={setLines} totalSen={amountSen} />
      <Field label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Anything finance should know" />
      {problem && <div role="alert" style={{ color: 'var(--color-critical-fg)' }}>{problem}</div>}
      <div><Button disabled={busy || reading} onClick={() => void send()}>{busy ? 'Sending…' : 'Hand in'}</Button></div>
    </Card>
  );
}

function RequestForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<'PAYMENT' | 'DEPOSIT'>('PAYMENT');
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [poId, setPoId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [amountSen, setAmountSen] = useState<number | null>(null);
  const [wantedOn, setWantedOn] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([blankLine(me.lineDepartment)]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const q = search.trim();
  const suppliers = useApi<{ suppliers: { id: string; code: string; name: string }[] }>(q.length >= 2 ? `/claims/suppliers?q=${encodeURIComponent(q)}` : null);
  const pos = useApi<{ purchaseOrders: { id: string; poNumber: string; status: string; totalSen: number }[] }>(q.length >= 2 ? `/claims/purchase-orders?q=${encodeURIComponent(q)}` : null);

  async function send() {
    setProblem(null);
    if (!supplierId && !poId && (type === 'DEPOSIT' || !payeeName.trim())) return setProblem(type === 'DEPOSIT' ? 'A deposit is paid to a supplier on the list.' : 'Choose the supplier, a PO, or type who is paid.');
    if (!amountSen || amountSen <= 0) return setProblem('Enter the amount.');
    if (files.length === 0) return setProblem('Add the invoice, receipt or quotation.');
    const built = toLines(lines, amountSen);
    if (!built.ok) return setProblem(built.message);
    setBusy(true);
    try {
      const made = await postWithFiles<{ requestNo: string }>('/claims/requests', {
        type, supplierId: supplierId || undefined, purchaseOrderId: poId || undefined, payeeName: payeeName.trim() || undefined,
        amountSen, wantedOn: wantedOn || undefined, note: note.trim() || undefined, lines: built.lines,
      }, files);
      toast({ tone: 'success', title: `Request ${made.requestNo} sent to finance` });
      onDone();
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Segmented label="What to pay" options={[{ key: 'PAYMENT' as const, label: 'A payment' }, { key: 'DEPOSIT' as const, label: 'A deposit' }]} value={type} onChange={setType} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
        <Field label="Find the supplier or PO" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, code or PO number" />
        <Select label="Purchase order" showLabel value={poId} onChange={v => { setPoId(v); if (v) setSupplierId(''); }} placeholder="Not against a PO"
          options={[{ value: '', label: 'Not against a PO' }, ...(pos.data?.purchaseOrders ?? []).map(p => ({ value: p.id, label: `${p.poNumber} · ${rm(p.totalSen)}` }))]} />
        {!poId && <Select label="Supplier" showLabel value={supplierId} onChange={setSupplierId} placeholder="Choose the supplier"
          options={[{ value: '', label: 'Not on the list' }, ...(suppliers.data?.suppliers ?? []).map(s => ({ value: s.id, label: `${s.code} ${s.name}` }))]} />}
        {!poId && !supplierId && type === 'PAYMENT' && <Field label="Pay to (not on the list)" value={payeeName} onChange={e => setPayeeName(e.target.value)} maxLength={200} help="Finance checks the payee before paying." />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <MoneyInput label="Amount" valueSen={amountSen} onChangeSen={setAmountSen} />
        <DateField label="Pay by (optional)" value={wantedOn} onChange={setWantedOn} min={todayMyt()} />
      </div>
      <FileDropRow label="Add the invoice, receipt or quotation" accept="image/*,application/pdf" multiple onPick={l => setFiles([...files, ...Array.from(l)].slice(0, 8))}
        chosen={files.length ? files.map(f => f.name).join(', ') : null} />
      <LinesEditor lines={lines} setLines={setLines} totalSen={amountSen} />
      <Field label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
      {problem && <div role="alert" style={{ color: 'var(--color-critical-fg)' }}>{problem}</div>}
      <div><Button disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send to finance'}</Button></div>
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
