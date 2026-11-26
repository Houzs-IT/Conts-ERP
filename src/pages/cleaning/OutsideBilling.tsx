import { useMemo, useState, type ReactNode } from 'react';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { DateField, MoneyInput } from '../../components/inputs';
import { StaleBanner } from '../../components/DataState';
import { EmptyState, Skeleton } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { ChoiceChips } from '../../components/ChoiceChips';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import { rm, monthLabel, plural } from '../../lib/format';
import { OpsModal, FormRow, INPUT, mytDay, dayLabel } from '../../components/ops/OpsUi';

/* Outside billing (chew, 26-27 Nov 2026): the cleaning team bills outside cleaning jobs, any it picks together on one
   invoice to the bill-to it types (a total typed over makes one lump-sum line, a package) or each job on its own, and
   records what the client pays. The invoice is booked at once (Dr 300-C002 CLEANING
   CUSTOMER / Cr 570-0000 cleaning income); a payment waits for finance to confirm it in the bank, which makes the
   receipt official (functions/_lib/cleaningBilling.ts, engine conts/cleaning-billing.ts). */

interface Job { id: string; day: string; kind: string; title: string; state: string; address: string; client: string | null; phone: string | null; amount: number | null; invoiceId: string | null; invoiceNo: string | null }
interface Payment { id: string; paidAt: string; method: string; amountSen: number; note: string | null; hasSlip: boolean; receiptNo: string | null; receiptStatus: string | null; confirmed: boolean }
interface Invoice {
  id: string; invoiceNo: string; invoiceDate: string; customerName: string; phone: string | null; address: string | null; totalSen: number;
  recordedSen: number; confirmedSen: number; outstandingSen: number; status: string; lump: boolean; lines: { taskIds: string[]; day: string | null; description: string; amountSen: number }[]; payments: Payment[];
}
const KIND: Record<string, string> = { turnover: 'Basic clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };
const METHOD: Record<string, string> = { cash: 'Cash', transfer: 'Bank transfer' };
const lastMonths = (n: number) => Array.from({ length: n }, (_, k) => { const d = new Date(`${mytDay(0).slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
const clientKey = (j: Job) => String(j.client ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const CARD = 'bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)] p-4 flex flex-col gap-3';
const openPrint = (path: string) => window.open(`/api${path}`, '_blank', 'noopener');

export function OutsideBillingView({ tabs }: { tabs: ReactNode }) {
  const toast = useToast();
  const [month, setMonth] = useState(mytDay(0).slice(0, 7));
  const { data, loading, error, reload } = useApi<{ month: string; jobs: Job[]; invoices: Invoice[] }>(`/housekeeping/cleaning-invoices?month=${month}`);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [billing, setBilling] = useState<'combine' | 'each' | null>(null);
  const [retotal, setRetotal] = useState<Invoice | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const jobs = data?.jobs ?? [];
  const unbilled = jobs.filter(j => !j.invoiceId);
  const invoices = (data?.invoices ?? []).slice().sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.invoiceNo.localeCompare(a.invoiceNo));
  /* The jobs not billed yet, by client: one invoice is for one client. */
  const groups = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of unbilled) { const k = clientKey(j) || `—${j.id}`; m.set(k, [...(m.get(k) ?? []), j]); }
    return [...m.values()];
  }, [unbilled]);
  const picked = unbilled.filter(j => picks.has(j.id));
  const toggle = (ids: string[], on: boolean) => setPicks(p => { const n = new Set(p); ids.forEach(id => (on ? n.add(id) : n.delete(id))); return n; });
  const open = invoices.reduce((n, i) => n + i.outstandingSen, 0);

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
      <PageHeader title="Cleaning" sub="Outside billing: invoice outside clients and record what they pay" actions={tabs} />
      {error && <StaleBanner message={error} onRetry={reload} />}

      <section className={CARD}>
        <div className="flex items-center gap-2 flex-wrap">
          <b className="text-copy flex-1">Not billed yet {unbilled.length ? `(${unbilled.length})` : ''}</b>
          {picked.length > 0 && <span className="text-meta text-muted-ink">{plural(picked.length, 'job')} · {rm(picked.reduce((n, j) => n + (j.amount ?? 0), 0))}</span>}
          <Button size="sm" variant="secondary" onClick={() => setBilling('each')} disabled={picked.length === 0} disabledReason="Tick the jobs to bill.">Bill each job</Button>
          <Button size="sm" variant="primary" onClick={() => setBilling('combine')} disabled={picked.length === 0} disabledReason="Tick the jobs to bill.">Bill together</Button>
        </div>
        <span className="text-meta text-muted-ink">Tick any jobs. Bill together puts them on one invoice (type a different total for a package); Bill each job makes one invoice per job.</span>
        {loading && !data ? <Skeleton height={120} /> : groups.length === 0 ? <span className="text-meta text-muted-ink">Every outside cleaning job is billed.</span> : groups.map(g => {
          const ids = g.map(j => j.id);
          const all = ids.every(id => picks.has(id));
          const name = g[0].client?.trim();
          return (
            <div key={ids[0]} className="flex flex-col border-t border-solid border-line-soft pt-2">
              <label className="flex items-center gap-2 text-copy font-semibold py-1 cursor-pointer">
                <input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = !all && ids.some(id => picks.has(id)); }} onChange={e => toggle(ids, e.target.checked)} />
                {name || <span className="text-muted-ink font-normal">No client name</span>}
                <span className="text-meta text-muted-ink font-normal">{plural(g.length, 'job')} · {rm(g.reduce((n, j) => n + (j.amount ?? 0), 0))}</span>
              </label>
              {g.map(j => (
                <label key={j.id} className="flex items-start md:items-center gap-2 pl-6 py-1 text-copy cursor-pointer max-md:min-h-11">
                  <input type="checkbox" className="mt-1 md:mt-0" checked={picks.has(j.id)} onChange={e => toggle([j.id], e.target.checked)} />
                  {/* On a phone the day sits over the place, and the status over the amount, so the address keeps its room. */}
                  <span className="flex-1 min-w-0 flex flex-col md:flex-row md:items-center md:gap-2">
                    <span className="md:w-[110px] flex-none text-muted-ink">{dayLabel(j.day)}</span>
                    <span className="flex-1 min-w-0 truncate">{KIND[j.kind] ?? j.title} · {j.address}</span>
                  </span>
                  <span className="flex flex-col items-end md:flex-row md:items-center gap-1 md:gap-2 flex-none">
                    {j.state === 'resolved' ? <StatusBadge tone="success" size="sm">Done</StatusBadge> : <StatusBadge tone="neutral" size="sm">Not done yet</StatusBadge>}
                    <span className="md:w-[96px] text-right tabular-nums">{j.amount ? rm(j.amount) : <span className="text-muted-ink">RM 0.00</span>}</span>
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </section>

      <section className={CARD}>
        <div className="flex items-center gap-2 flex-wrap">
          <b className="text-copy flex-1">Invoices</b>
          {open > 0 && <span className="text-meta text-muted-ink">Still to collect {rm(open)}</span>}
          <label className="flex items-center gap-2 text-meta text-muted-ink">Month
            <select className={cx(INPUT, 'h-9 w-auto')} value={month} onChange={e => setMonth(e.target.value)}>
              {lastMonths(12).map(m => <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>)}
            </select>
          </label>
        </div>
        <span className="text-meta text-muted-ink">The invoices of jobs this month. A payment stays "Waiting for finance" until finance confirms the money in the bank; then its receipt is official.</span>
        {loading && !data ? <Skeleton height={120} /> : invoices.length === 0 ? <EmptyState icon="Sparkles" title={`No outside cleaning invoices in ${monthLabel(`${month}-01`)}.`} /> : invoices.map(inv => (
          <div key={inv.id} className="flex flex-col gap-2 border-t border-solid border-line-soft pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <b className="text-copy">{inv.invoiceNo}</b>
              <span className="text-copy">{inv.customerName}</span>
              <span className="text-meta text-muted-ink">{dayLabel(inv.invoiceDate)} · {plural(inv.lines.reduce((n, l) => n + l.taskIds.length, 0), 'job')}</span>
              {inv.lump && <StatusBadge tone="neutral" size="sm">Lump sum</StatusBadge>}
              {inv.status === 'CANCELLED' ? <StatusBadge tone="danger" size="sm">Cancelled</StatusBadge>
                : inv.outstandingSen === 0 ? <StatusBadge tone={inv.confirmedSen >= inv.totalSen ? 'success' : 'warning'} size="sm">{inv.confirmedSen >= inv.totalSen ? 'Paid' : 'Paid, waiting for finance'}</StatusBadge>
                : inv.recordedSen > 0 ? <StatusBadge tone="warning" size="sm">Part paid</StatusBadge> : <StatusBadge tone="neutral" size="sm">Not paid</StatusBadge>}
              <span className="flex-1" />
              <span className="text-copy tabular-nums">{rm(inv.totalSen)}{inv.outstandingSen > 0 && inv.outstandingSen < inv.totalSen ? <span className="text-meta text-muted-ink"> · {rm(inv.outstandingSen)} left</span> : null}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => openPrint(`/housekeeping/cleaning-invoices/${inv.id}/print`)}>Print invoice</Button>
              {inv.lump && inv.status !== 'CANCELLED' && <Button size="sm" variant="secondary" onClick={() => setRetotal(inv)}>Change total</Button>}
              <Button size="sm" variant="primary" onClick={() => setPaying(inv)} disabled={inv.status === 'CANCELLED' || inv.outstandingSen === 0}
                disabledReason={inv.status === 'CANCELLED' ? 'This invoice is cancelled.' : 'Paid in full.'}>Collect payment</Button>
            </div>
            {inv.payments.length > 0 && (
              <div className="flex flex-col gap-1">
                {inv.payments.map(p => (
                  <div key={p.id} className="flex items-center gap-x-2 gap-y-1 flex-wrap text-meta pl-1">
                    <span className="md:w-[110px] text-muted-ink">{dayLabel(p.paidAt)}</span>
                    <span>{METHOD[p.method] ?? p.method} {rm(p.amountSen)}</span>
                    {p.receiptStatus === 'CANCELLED' ? <StatusBadge tone="danger" size="sm">Cancelled</StatusBadge>
                      : p.confirmed ? <StatusBadge tone="success" size="sm">{p.receiptNo ?? 'Confirmed'}</StatusBadge>
                      : <StatusBadge tone="warning" size="sm">Waiting for finance</StatusBadge>}
                    <button type="button" className="bg-transparent border-0 p-0 text-gold-ink font-medium cursor-pointer [font-family:inherit]" onClick={() => openPrint(`/housekeeping/cleaning-invoices/${inv.id}/print?payment=${p.id}`)}>Print receipt</button>
                    {p.hasSlip && <a className="text-gold-ink font-medium" href={`/api/housekeeping/cleaning-invoices/${inv.id}/payments/${p.id}/slip`} target="_blank" rel="noopener noreferrer">Slip</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      {billing === 'combine' && <BillModal jobs={picked} onClose={() => setBilling(null)} onDone={no => { setBilling(null); setPicks(new Set()); toast({ tone: 'success', title: `Invoice ${no} issued.`, body: 'Print it from Invoices for the client.' }); reload(); }} />}
      {billing === 'each' && <BillEachModal jobs={picked} onClose={() => setBilling(null)} onDone={(title, body) => { setBilling(null); setPicks(new Set()); toast({ tone: body ? 'warning' : 'success', title, body }); reload(); }} />}
      {retotal && <TotalModal invoice={retotal} onClose={() => setRetotal(null)} onDone={() => { setRetotal(null); toast({ tone: 'success', title: `${retotal.invoiceNo} total changed.`, body: 'Print it again for the client.' }); reload(); }} />}
      {paying && <PaymentModal invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); toast({ tone: 'success', title: 'Payment recorded.', body: 'It waits for finance to confirm the money in the bank.' }); reload(); }} />}
    </div>
  );
}

function BillModal({ jobs, onClose, onDone }: { jobs: Job[]; onClose: () => void; onDone: (invoiceNo: string) => void }) {
  const sorted = jobs.slice().sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted.find(j => j.client?.trim()) ?? sorted[0];
  const sum = jobs.reduce((n, j) => n + (j.amount ?? 0), 0);
  const [billTo, setBillTo] = useState(first?.client?.trim() ?? '');
  const [phone, setPhone] = useState(sorted.find(j => j.phone)?.phone ?? '');
  const [address, setAddress] = useState(first?.address ?? '');
  const [date, setDate] = useState(mytDay(0));
  const [total, setTotal] = useState<number | null>(sum || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string | undefined>>({});
  const lump = total !== sum || jobs.some(j => !j.amount);
  async function save() {
    const bad = { billTo: billTo.trim() ? undefined : 'Enter who the invoice is to.', total: total && total > 0 ? undefined : 'Enter the invoice total.' };
    if (bad.billTo || bad.total) { setErr(bad); return; }
    setBusy(true); setErr({});
    try {
      const r = await api.post<{ invoice: { invoiceNo: string } }>('/housekeeping/cleaning-invoices', {
        mode: 'combine', taskIds: jobs.map(j => j.id), invoiceDate: date, customerName: billTo.trim(), phone: phone.trim() || undefined, address: address.trim() || undefined, totalSen: total,
      });
      onDone(r.invoice.invoiceNo);
    } catch (e) { setErr({ form: errorMessage(e, 'The invoice was not made. Try again.') }); setBusy(false); }
  }
  return (
    <OpsModal title="Bill together" eyebrow="Outside billing" size="md" onClose={onClose} busy={busy}
      sub={`${plural(jobs.length, 'job')} on one invoice. It is issued and booked at once.`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Issue invoice {total ? rm(total) : ''}</Button></>}>
      <FormRow label="Bill to" error={err.billTo}><input className={INPUT} value={billTo} onChange={e => { setBillTo(e.target.value); setErr(x => ({ ...x, billTo: undefined })); }} maxLength={120} /></FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Phone (optional)"><input className={INPUT} value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} inputMode="tel" /></FormRow>
        <FormRow label="Invoice date"><DateField aria-label="Invoice date" className={INPUT} value={date} onChange={v => v && setDate(v)} /></FormRow>
      </div>
      <FormRow label="Address (optional)"><input className={INPUT} value={address} onChange={e => setAddress(e.target.value)} maxLength={300} /></FormRow>
      <div className="flex flex-col gap-1 text-copy">
        {sorted.map(j => (
          <div key={j.id} className="flex gap-2"><span className="w-[110px] text-muted-ink">{dayLabel(j.day)}</span><span className="flex-1 min-w-0 truncate">{KIND[j.kind] ?? j.title} · {j.address}</span><span className="tabular-nums">{rm(j.amount ?? 0)}</span></div>
        ))}
      </div>
      <FormRow label="Invoice total, RM" error={err.total} hint={lump ? 'One lump-sum line with every job\'s day, at this total.' : 'One line per job, at its amount. Type a different total to bill it as one lump sum (a package).'}>
        <MoneyInput className={INPUT} valueSen={total} onChangeSen={v => { setTotal(v); setErr(x => ({ ...x, total: undefined })); }} aria-label="Invoice total in RM" />
      </FormRow>
      {err.form && <span className="text-meta text-danger" role="alert">{err.form}</span>}
    </OpsModal>
  );
}

function BillEachModal({ jobs, onClose, onDone }: { jobs: Job[]; onClose: () => void; onDone: (title: string, body?: string) => void }) {
  const [date, setDate] = useState(mytDay(0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ invoices: unknown[]; failed: { taskId: string; message: string }[] }>('/housekeeping/cleaning-invoices', { mode: 'each', taskIds: jobs.map(j => j.id), invoiceDate: date });
      onDone(`${plural(r.invoices.length, 'invoice')} issued.`, r.failed.length ? `${plural(r.failed.length, 'job')} not billed: ${r.failed[0].message}` : undefined);
    } catch (e) { setErr(errorMessage(e, 'Nothing was billed. Try again.')); setBusy(false); }
  }
  return (
    <OpsModal title="Bill each job" eyebrow="Outside billing" size="md" onClose={onClose} busy={busy}
      sub={`${plural(jobs.length, 'invoice')}, one per job, each to the job's own client at its amount.`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Issue {plural(jobs.length, 'invoice')}</Button></>}>
      <FormRow label="Invoice date"><DateField aria-label="Invoice date" className={INPUT} value={date} onChange={v => v && setDate(v)} /></FormRow>
      <div className="flex flex-col gap-1 text-copy">
        {jobs.slice().sort((a, b) => a.day.localeCompare(b.day)).map(j => (
          <div key={j.id} className="flex gap-2"><span className="w-[110px] text-muted-ink">{dayLabel(j.day)}</span><span className="flex-1 min-w-0 truncate">{j.client?.trim() || <span className="text-warning">No client name</span>} · {j.address}</span><span className="tabular-nums">{j.amount ? rm(j.amount) : <span className="text-warning">RM 0.00</span>}</span></div>
        ))}
      </div>
      {err && <span className="text-meta text-danger" role="alert">{err}</span>}
    </OpsModal>
  );
}

function TotalModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [total, setTotal] = useState<number | null>(invoice.totalSen);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!total || total <= 0) { setErr('Enter the new total.'); return; }
    if (total < invoice.recordedSen) { setErr(`At least ${rm(invoice.recordedSen)}, what the client has paid.`); return; }
    setBusy(true); setErr(null);
    try { await api.post(`/housekeeping/cleaning-invoices/${invoice.id}/total`, { totalSen: total }); onDone(); }
    catch (e) { setErr(errorMessage(e, 'Not changed. Try again.')); setBusy(false); }
  }
  return (
    <OpsModal title="Change total" eyebrow={invoice.invoiceNo} size="md" onClose={onClose} busy={busy}
      sub={`${invoice.customerName}: now ${rm(invoice.totalSen)}. The books follow the new total; print the invoice again for the client.`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Save total</Button></>}>
      <FormRow label="Invoice total, RM" error={err}><MoneyInput className={INPUT} valueSen={total} onChangeSen={v => { setTotal(v); setErr(null); }} aria-label="Invoice total in RM" /></FormRow>
    </OpsModal>
  );
}

function PaymentModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [paidAt, setPaidAt] = useState(mytDay(0));
  const [method, setMethod] = useState<'transfer' | 'cash'>('transfer');
  const [amount, setAmount] = useState<number | null>(invoice.outstandingSen);
  const [note, setNote] = useState('');
  const [slip, setSlip] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string | undefined>>({});
  async function save() {
    const bad = { amount: amount && amount > 0 ? (amount > invoice.outstandingSen ? `At most ${rm(invoice.outstandingSen)}, what is left on this invoice.` : undefined) : 'Enter the amount paid.', slip: method === 'transfer' && !slip ? 'Attach the transfer slip.' : undefined };
    if (bad.amount || bad.slip) { setErr(bad); return; }
    setBusy(true); setErr({});
    try {
      const fd = new FormData();
      fd.append('paidAt', paidAt); fd.append('method', method); fd.append('amount', String(amount)); if (note.trim()) fd.append('note', note.trim()); if (slip) fd.append('slip', slip);
      await api.post(`/housekeeping/cleaning-invoices/${invoice.id}/payments`, fd);
      onDone();
    } catch (e) { setErr({ form: errorMessage(e, 'Not saved. Try again.') }); setBusy(false); }
  }
  return (
    <OpsModal title="Collect payment" eyebrow={invoice.invoiceNo} size="md" onClose={onClose} busy={busy}
      sub={`${invoice.customerName}: ${rm(invoice.outstandingSen)} left of ${rm(invoice.totalSen)}. Finance confirms the money in the bank before it counts as received.`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Save payment</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Day paid"><DateField aria-label="Day paid" className={INPUT} value={paidAt} max={mytDay(0)} onChange={v => v && setPaidAt(v)} /></FormRow>
        <FormRow label="Amount, RM" error={err.amount}><MoneyInput className={INPUT} valueSen={amount} onChangeSen={v => { setAmount(v); setErr(x => ({ ...x, amount: undefined })); }} aria-label="Amount paid in RM" /></FormRow>
      </div>
      <ChoiceChips<'transfer' | 'cash'> label="Method" value={method} onChange={setMethod} options={[{ value: 'transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }]} />
      <FormRow label={method === 'transfer' ? 'Transfer slip' : 'Slip or photo (optional)'} error={err.slip} hint="A photo or PDF.">
        <input type="file" accept="image/*,application/pdf" onChange={e => { setSlip(e.target.files?.[0] ?? null); setErr(x => ({ ...x, slip: undefined })); }} aria-label="Slip" className="text-copy" />
      </FormRow>
      <FormRow label="Note (optional)"><input className={INPUT} value={note} onChange={e => setNote(e.target.value)} maxLength={300} /></FormRow>
      {err.form && <span className="text-meta text-danger" role="alert">{err.form}</span>}
    </OpsModal>
  );
}
