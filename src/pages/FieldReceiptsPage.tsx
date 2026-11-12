import { useRef, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { Select } from '../components/Select';
import { Field } from '../components/Field';
import { MoneyInput, DateField } from '../components/inputs';
import { FileDropRow } from '../components/Attachments';
import { ChoiceChips } from '../components/ChoiceChips';
import { ClaimBankFields, useSavedBank } from '../components/ops/ClaimBankFields';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { rm, todayMyt } from '../lib/format';
import { usePortalText, usePortalDates, wordFor } from '../lib/portalI18n';
import { bankProblem, postWithFiles, readReceipt, readRequestBill, receiptFileHref, thisMonthMyt, type ClaimBank, type Me, type MyFloat, type Receipt } from '../lib/claims';

/* ------------------------------------------------------------------ *
 * Portal > Receipts (finance, 28-29 Oct 2026; SOP 6): a cleaner or technician who paid for something for work hands
 * the receipt in from the phone, and sees what became of it. Three ways (chew, 12 Nov 2026): Petty Cash (Claim), the
 * default; Direct Claim to Me, paid back by finance to the bank confirmed on the claim; Direct Pay to Supplier, a payment
 * request finance pays to the supplier named on the bill. A job's own claim is handed in on the job (FieldRepairsPage). The person who keeps their department's petty cash also sees the float here: what they should
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

type Way = 'float' | 'finance' | 'supplier';

function HandIn({ me, onClose, onDone }: { me: Me; onClose: () => void; onDone: () => void }) {
  const t = usePortalText();
  const tr = t.receipts;
  const p = t.claimPay;
  const toast = useToast();
  const units = useApi<{ units: { id: string; building: string; unitNumber: string }[] }>('/claims/units');
  /* Petty Cash (Claim) is the default, and is not offered to someone with no petty cash. */
  const pettyCashOffered = me.route !== 'finance';
  const [chosen, setChosen] = useState<Way>(pettyCashOffered ? 'float' : 'finance');
  const way: Way = !pettyCashOffered && chosen === 'float' ? 'finance' : chosen;
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const reads = useRef(0);
  const [amountSen, setAmountSen] = useState<number | null>(null);
  const [spendDate, setSpendDate] = useState(todayMyt());
  const dateTouched = useRef(false);
  const [vendorName, setVendorName] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [wantedOn, setWantedOn] = useState('');
  const [unitId, setUnitId] = useState('');
  const [note, setNote] = useState('');
  // The saved details fill the empty bank fields once, when Direct Claim to Me is first chosen.
  const [bank, setBank] = useSavedBank(way === 'finance');
  const [wrongBank, setWrongBank] = useState<keyof ClaimBank | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* The photo is read in the background (the bill reader for a supplier's bill): the person may type and send
     meanwhile, and only the fields still empty are filled, so nothing typed is overwritten. */
  function pick(list: FileList) {
    const all = [...files, ...Array.from(list)].slice(0, 8);
    setFiles(all);
    setReading(true);
    const n = ++reads.current;
    const today = todayMyt();
    void (async () => {
      if (way === 'supplier') {
        const read = await readRequestBill(all);
        if (read.amountSen != null && read.amountSen > 0) setAmountSen(cur => cur ?? read.amountSen);
        const named = read.supplier?.name ?? read.vendorName;
        if (named) setPayeeName(cur => (cur.trim() ? cur : named.slice(0, 200)));
        if (read.dueDate && read.dueDate >= today) { const due = read.dueDate; setWantedOn(cur => cur || due); }
        if (read.summary) { const what = read.summary.slice(0, 300); setNote(cur => (cur.trim() ? cur : what)); }
      } else {
        const read = await readReceipt(all);
        if (read.amountSen != null) setAmountSen(cur => cur ?? read.amountSen);
        if (read.date && read.date <= today && !dateTouched.current) setSpendDate(read.date);
        if (read.vendorName) { const shop = read.vendorName; setVendorName(cur => cur || shop); setPayeeName(cur => (cur.trim() ? cur : shop.slice(0, 200))); }
      }
      if (n === reads.current) setReading(false);
    })();
  }

  async function send() {
    setProblem(null);
    if (files.length === 0) return setProblem(way === 'supplier' ? tr.needBill : tr.needPhoto);
    if (!amountSen || amountSen <= 0) return setProblem(tr.needAmount);
    const line = { department: me.lineDepartment, amountSen, description: note.trim() || undefined, ...(unitId ? { unitId } : {}) };
    if (way === 'supplier' && !payeeName.trim()) return setProblem(tr.needPayee);
    const badBank = way === 'finance' ? bankProblem(bank) : null;
    if (badBank) return setWrongBank(badBank);
    setBusy(true);
    try {
      if (way === 'supplier') {
        // A field worker names the supplier as on the bill; finance matches it to the list when it pays.
        await postWithFiles('/claims/requests', {
          type: 'PAYMENT', payeeName: payeeName.trim(), amountSen, wantedOn: wantedOn || undefined, note: note.trim() || undefined, lines: [line],
        }, files);
        toast({ tone: 'success', title: tr.supplierSent });
      } else {
        const made = await postWithFiles<{ route: 'float' | 'finance' }>('/claims/receipts', {
          spendDate, amountSen, vendorName: vendorName.trim() || undefined, note: note.trim() || undefined, lines: [line],
          ...(way === 'finance' ? { payBack: 'finance', bank } : {}),
        }, files);
        toast({ tone: 'success', title: tr.sent, body: way === 'finance' ? p.directSent : made.route === 'float' ? tr.paidFromFloat : tr.paidByFinance });
      }
      onDone();
    } catch (e) { setProblem(errorMessage(e, tr.notSent)); } finally { setBusy(false); }
  }

  const ways = [
    ...(pettyCashOffered ? [{ value: 'float' as const, label: p.pettyCash }] : []),
    { value: 'finance' as const, label: p.direct },
    { value: 'supplier' as const, label: p.supplier },
  ];
  const wayNote = way === 'supplier' ? p.supplierNote : way === 'finance' ? (pettyCashOffered ? p.directNote : p.noFloatNote) : p.pettyCashNote;
  return (
    <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-3">
      <ChoiceChips label={p.label} options={ways} value={way} help={wayNote} onChange={v => { setChosen(v); setProblem(null); setWrongBank(null); }} />
      <FileDropRow label={reading ? tr.reading : way === 'supplier' ? tr.billPhoto : tr.photo} hint={way === 'supplier' ? tr.billHint : tr.photoHint}
        accept="image/*,application/pdf" multiple onPick={pick} busy={reading} chosen={files.length ? files.map(f => f.name).join(', ') : null} tall />
      {way === 'supplier' && <Field label={tr.payee} value={payeeName} onChange={e => setPayeeName(e.target.value)} placeholder={tr.payeePh} maxLength={200} />}
      <MoneyInput label={tr.amount} valueSen={amountSen} onChangeSen={setAmountSen} />
      {way === 'supplier'
        ? <DateField label={tr.payBy} value={wantedOn} onChange={setWantedOn} min={todayMyt()} />
        : <DateField label={tr.date} value={spendDate} onChange={v => { setSpendDate(v); dateTouched.current = true; }} max={todayMyt()} />}
      <Field label={tr.note} value={note} onChange={e => setNote(e.target.value)} placeholder={tr.notePh} maxLength={300} />
      <Select label={tr.unit} showLabel size="md" value={unitId} onChange={setUnitId}
        options={[{ value: '', label: tr.noUnit }, ...(units.data?.units ?? []).map(u => ({ value: u.id, label: `${u.building} ${u.unitNumber}` }))]} />
      {way === 'finance' && (
        <ClaimBankFields bank={bank} wrong={wrongBank} t={t} touch
          onChange={(k, v) => { setBank(b => ({ ...b, [k]: v })); if (wrongBank === k) setWrongBank(null); }} />
      )}
      {problem && <span role="alert" className="text-meta text-danger">{problem}</span>}
      <span className="flex gap-2">
        <Button size="touch" variant="primary" className="flex-1" loading={busy} disabled={busy} onClick={() => void send()}>{way === 'supplier' ? tr.sendToFinance : tr.send}</Button>
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
