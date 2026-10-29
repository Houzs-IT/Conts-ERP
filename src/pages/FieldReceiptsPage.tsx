import { useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { Select } from '../components/Select';
import { Field } from '../components/Field';
import { MoneyInput, DateField } from '../components/inputs';
import { FileDropRow } from '../components/Attachments';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { rm, todayMyt } from '../lib/format';
import { usePortalText, usePortalDates, wordFor } from '../lib/portalI18n';
import { postWithFiles, readReceipt, receiptFileHref, thisMonthMyt, type Me, type MyFloat, type Receipt } from '../lib/claims';

/* ------------------------------------------------------------------ *
 * Portal > Receipts (finance, 28-29 Oct 2026; SOP 6): a cleaner or technician who paid for something for work hands
 * the receipt in from the phone, and sees what became of it. A job's own purchase is handed in on the job instead
 * (FieldRepairsPage). The person who keeps their department's petty cash also sees the float here: what they should
 * hold, the receipts on it this month, and a way to ask finance for a top-up. Amounts are their own receipts' and,
 * for a keeper, their float's; never a job's quote or cost.
 * ------------------------------------------------------------------ */
export default function FieldReceiptsPage() {
  const t = usePortalText();
  const tr = t.receipts;
  const me = useApi<Me>('/claims/me');
  // Every month: a receipt rejected last month must stay in sight until it is dealt with.
  const mine = useApi<{ receipts: Receipt[] }>('/claims/receipts');
  const [handingIn, setHandingIn] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-title font-semibold">{tr.title}</h1>
        <div className="text-copy text-muted-ink">{tr.intro}</div>
      </div>
      {me.error && <StaleBanner message={me.error} onRetry={me.reload} />}
      {!handingIn && <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Receipt" size="sm" />} onClick={() => setHandingIn(true)}>{tr.handIn}</Button>}
      {handingIn && me.data && <HandIn me={me.data} onClose={() => setHandingIn(false)} onDone={() => { setHandingIn(false); mine.reload(); }} />}
      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{tr.mine}</h2>
        {mine.error && <StaleBanner message={mine.error} onRetry={mine.reload} />}
        {mine.data && mine.data.receipts.length === 0 && <span className="text-copy text-muted-ink">{tr.none}</span>}
        {mine.data?.receipts.map(r => <ReceiptCard key={r.id} r={r} />)}
      </section>
      {me.data?.keepsFloat && <KeptFloat />}
    </div>
  );
}

function ReceiptCard({ r, by }: { r: Receipt; by?: boolean }) {
  const t = usePortalText();
  const tr = t.receipts;
  const { short } = usePortalDates();
  return (
    <div className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <span className="text-copy font-semibold">{r.vendorName || r.lines.map(l => l.description).filter(Boolean).join('; ') || r.receiptNo}</span>
        <span className="text-copy font-semibold tabular-nums">{rm(r.amountSen)}</span>
      </span>
      <span className="text-meta text-muted-ink">
        {short(r.spendDate)}{by ? ` · ${tr.by(r.submitterName)}` : ''} · {wordFor(tr.status, r.status)}
      </span>
      {r.status === 'REJECTED' && r.rejectReason && <span className="text-meta text-danger">{tr.rejected(r.rejectReason)}</span>}
      {r.files.length > 0 && (
        <span className="flex gap-3">
          {r.files.map((f, i) => <a key={f.id} className="text-meta underline" href={receiptFileHref(r.id, f.id)} target="_blank" rel="noreferrer">{tr.open}{r.files.length > 1 ? ` ${i + 1}` : ''}</a>)}
        </span>
      )}
    </div>
  );
}

function HandIn({ me, onClose, onDone }: { me: Me; onClose: () => void; onDone: () => void }) {
  const t = usePortalText();
  const tr = t.receipts;
  const toast = useToast();
  const units = useApi<{ units: { id: string; building: string; unitNumber: string }[] }>('/claims/units');
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [amountSen, setAmountSen] = useState<number | null>(null);
  const [spendDate, setSpendDate] = useState(todayMyt());
  const [dateTouched, setDateTouched] = useState(false);
  const [vendorName, setVendorName] = useState('');
  const [unitId, setUnitId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(list: FileList) {
    const chosen = [...files, ...Array.from(list)].slice(0, 8);
    setFiles(chosen);
    setReading(true);
    const read = await readReceipt(chosen);
    setReading(false);
    if (read.amountSen != null && amountSen == null) setAmountSen(read.amountSen);
    if (read.date && read.date <= todayMyt() && !dateTouched) setSpendDate(read.date);
    if (read.vendorName && !vendorName) setVendorName(read.vendorName);
  }
  async function send() {
    setProblem(null);
    if (files.length === 0) return setProblem(tr.needPhoto);
    if (!amountSen || amountSen <= 0) return setProblem(tr.needAmount);
    setBusy(true);
    try {
      const made = await postWithFiles<{ route: 'float' | 'finance' }>('/claims/receipts', {
        spendDate, amountSen, vendorName: vendorName.trim() || undefined, note: note.trim() || undefined,
        lines: [{ department: me.lineDepartment, amountSen, description: note.trim() || undefined, ...(unitId ? { unitId } : {}) }],
      }, files);
      toast({ tone: 'success', title: tr.sent, body: made.route === 'float' ? tr.paidFromFloat : tr.paidByFinance });
      onDone();
    } catch (e) { setProblem(errorMessage(e, tr.notSent)); } finally { setBusy(false); }
  }
  return (
    <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-3">
      <FileDropRow label={reading ? tr.reading : tr.photo} hint={tr.photoHint} accept="image/*,application/pdf" multiple onPick={l => void pick(l)} busy={reading}
        chosen={files.length ? files.map(f => f.name).join(', ') : null} tall />
      <MoneyInput label={tr.amount} valueSen={amountSen} onChangeSen={setAmountSen} />
      <DateField label={tr.date} value={spendDate} onChange={v => { setSpendDate(v); setDateTouched(true); }} max={todayMyt()} />
      <Field label={tr.note} value={note} onChange={e => setNote(e.target.value)} placeholder={tr.notePh} maxLength={300} />
      <Select label={tr.unit} showLabel size="md" value={unitId} onChange={setUnitId}
        options={[{ value: '', label: tr.noUnit }, ...(units.data?.units ?? []).map(u => ({ value: u.id, label: `${u.building} ${u.unitNumber}` }))]} />
      <span className="text-meta text-muted-ink">{me.route === 'float' ? tr.paidFromFloat : tr.paidByFinance}</span>
      {problem && <span role="alert" className="text-meta text-danger">{problem}</span>}
      <span className="flex gap-2">
        <Button size="touch" variant="primary" className="flex-1" disabled={busy || reading} onClick={() => void send()}>{tr.send}</Button>
        <Button size="touch" variant="secondary" disabled={busy} onClick={onClose}>{t.common.back}</Button>
      </span>
    </section>
  );
}

function KeptFloat() {
  const t = usePortalText();
  const tr = t.receipts;
  const toast = useToast();
  const q = useApi<MyFloat>(`/claims/float?month=${thisMonthMyt()}`);
  const f = q.data?.float;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{tr.keeper}</h2>
      {q.error && <StaleBanner message={q.error} onRetry={q.reload} />}
      {f && (
        <div className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col gap-1">
          <span className="text-meta text-muted-ink">{tr.balance}</span>
          <span className={`text-[26px] leading-tight font-bold tabular-nums ${f.balanceSen < 0 ? 'text-danger' : ''}`}>{rm(f.balanceSen)}</span>
          <span className="text-meta text-muted-ink">{tr.float(rm(f.floatSen))}</span>
          {(f.balanceSen < 0 || f.low) && <span className="text-meta text-danger">{f.balanceSen < 0 ? tr.belowZero : tr.low}</span>}
          <Button size="touch" variant="secondary" disabled={f.topUpRequested} onClick={async () => {
            try { await api.post('/claims/float/top-up-request', {}); toast({ tone: 'success', title: tr.askedTopUp }); q.reload(); }
            catch (e) { toast({ tone: 'critical', title: tr.notSent, body: errorMessage(e) }); }
          }}>{f.topUpRequested ? tr.topUpAsked : tr.askTopUp}</Button>
        </div>
      )}
      {q.data && q.data.receipts.length > 0 && <span className="text-meta text-muted-ink">{tr.onFloat}</span>}
      {q.data?.receipts.map(r => <ReceiptCard key={r.id} r={r} by />)}
    </section>
  );
}
