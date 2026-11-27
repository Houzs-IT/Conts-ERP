import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { ComboSelect, type SelectOption } from '../components/Select';
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
import { FileDropRow, MediaViewer, type MediaItem } from '../components/Attachments';
import { ClaimPapers, claimFileItem } from './claims/ClaimPapers';
import { MoneyInput, DateField } from '../components/inputs';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { mayWork } from '../lib/areaAccess';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { date, monthLabel, rm, todayMyt } from '../lib/format';
import {
  bankProblem, RECEIPT_STATUS, RECEIPT_TONE, REQUEST_STATUS, REQUEST_TONE, describeClaimLine, postWithFiles, readReceipt, readRequestBill, receiptFileHref, renoReviewFileHref, requestBillFill, requestFileHref, thisMonthMyt,
  type ClaimBank, type ClaimFile, type ClaimLine, type Me, type MyFloat, type PaymentRequest, type Receipt
} from '../lib/claims';
import { canResubmit, fixOnUtilityBills, lineDraftOf, reasonNote, wantedOnAgain } from '../lib/requestResubmit';
import { balanceSen, billLabel, canAskBalance, onBill, updatedFromBill } from '../lib/requestApInvoice';
import { depositSen, percentOf } from '../lib/deposit';
import { ClaimBankFields, useSavedBank } from '../components/ops/ClaimBankFields';
import { usePortalText } from '../lib/portalI18n';
import { LinesEditor, blankLine, toLines, type LineDraft } from './claims/ClaimLines';
import { ClaimSection, FORM_FOOTER, GridRow, TWO_COLUMN_GRID, RowHelp } from './claims/FormLayout';
import { SupplierPicker, type Supplier } from './claims/SupplierPicker';

/**
 * My claims (finance, 28-29 Oct 2026; SOP 3.2, 6): a member of staff hands something in and follows it, and, if they
 * keep their department's petty cash, sees the float. One form (chew, 2 Nov 2026; plan 2026-11-02-my-claims-one-form):
 * "Claim to me" for what they paid (paid back from the department's float, or by finance by transfer when there is
 * none), or "Direct pay" for finance to pay a supplier (a payment, or a deposit before the bill). Nobody who hands in
 * chooses the account (finance does, while checking), and a line's department is the person's (the engine sets it).
 * Everything is kept in the engine; this page reaches it through /api/claims (functions/api/claims/[[path]].ts).
 */
type Tab = 'handin' | 'mine' | 'float' | 'review';
type Kind = 'claim' | 'direct';
const RENO_FIRST_NOTE = 'It goes to the renovation reviewer first, then to finance.';
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
  const { user } = useSession();
  const canReview = mayWork(user, 'renoClaimReview');
  const [tab, setTab] = useState<Tab>('handin');
  const [handInKind, setHandInKind] = useState<Kind>('claim');
  const [mineMonth, setMineMonth] = useState(thisMonthMyt());
  /* A withdrawn or rejected request being changed to send again (chew, 13 Nov 2026): the Hand in form, filled in. */
  const [editing, setEditing] = useState<PaymentRequest | null>(null);
  const [reviewing, setReviewing] = useState<PaymentRequest | null>(null);
  const startHandIn = (kind: Kind) => { setEditing(null); setHandInKind(kind); setTab('handin'); };
  const startEdit = (q: PaymentRequest) => { setEditing(q); setTab('handin'); };
  const showMine = (month: string) => { setEditing(null); setMineMonth(month); setTab('mine'); };
  const tabs = [
    { key: 'handin' as const, label: 'Hand in' },
    { key: 'mine' as const, label: 'Mine' },
    ...(me.data?.keepsFloat ? [{ key: 'float' as const, label: 'Petty cash I keep' }] : []),
    ...(canReview ? [{ key: 'review' as const, label: 'To review' }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My claims" sub="Claim back what you paid, or ask finance to pay a supplier." />
      {me.error && <StaleBanner message={me.error} onRetry={me.reload} />}
      <Segmented label="My claims" options={tabs} value={tab} onChange={t => { if (t !== 'handin') setEditing(null); setReviewing(null); setTab(t); }} className="self-start" />
      {tab === 'handin' && me.data && <HandInForm key={editing?.id ?? 'new'} me={me.data} initialKind={editing ? 'direct' : handInKind} editing={editing}
        onDone={showMine} onCancelEdit={() => { setEditing(null); setTab('mine'); }} />}
      {tab === 'mine' && <Mine month={mineMonth} onMonthChange={setMineMonth} onHandIn={startHandIn} onEdit={startEdit} />}
      {tab === 'float' && <KeptFloat />}
      {tab === 'review' && canReview && (reviewing && me.data
        ? <HandInForm key={reviewing.id} me={me.data} initialKind="direct" onDone={showMine}
          reviewing={{ request: reviewing, onBack: () => setReviewing(null), onDone: () => setReviewing(null) }} />
        : <RenoReview onOpen={setReviewing} />)}
    </div>
  );
}

/** One form: Claim to me (I paid; pay me back) or Direct pay (finance pays a supplier). What both share stays when switching.
 *  With `editing`, a withdrawn or rejected request filled in as it was, to change and send again under its own number
 *  (chew, 13 Nov 2026); its papers stay unless removed, and new ones can be added. */
interface ReviewingRequest { request: PaymentRequest; onBack: () => void; onDone: () => void }

function HandInForm({ me, initialKind, onDone, editing = null, onCancelEdit, reviewing }: {
  me: Me; initialKind: Kind; onDone: (mineMonth: string) => void; editing?: PaymentRequest | null; onCancelEdit?: () => void; reviewing?: ReviewingRequest;
}) {
  const toast = useToast();
  const seed = editing ?? reviewing?.request ?? null;
  const [isSendingBack, setIsSendingBack] = useState(false);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [amountSen, setAmountSen] = useState<number | null>(seed?.amountSen ?? null);
  const [note, setNote] = useState(seed?.note ?? '');
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (!seed?.lines.length) return [blankLine()];
    /* What the owners pay back goes onto the unit's lines again, the first of them first. */
    const left = new Map((seed.recoveries ?? []).map(r => [r.unitId, r.amountSen]));
    return seed.lines.map(l => {
      const d = lineDraftOf(l);
      const back = l.unitId ? Math.min(left.get(l.unitId) ?? 0, l.amountSen) : 0;
      if (!back) return d;
      left.set(l.unitId!, (left.get(l.unitId!) ?? 0) - back);
      return { ...d, recover: true, recoverSen: back };
    });
  });
  const [files, setFiles] = useState<File[]>([]);
  const [kept, setKept] = useState<ClaimFile[]>(seed?.files ?? []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* Paid back by transfer: the person confirms or changes the account on the claim, as the phone's Direct Claim to Me
     does (chew, 23 Nov 2026); it starts from their saved details and a change stays on this claim. */
  const t = usePortalText();
  /* Someone whose department keeps petty cash chooses, as on the phone, whether this claim is paid from it or by
     finance's transfer (chew, 26 Nov 2026: Alex's own claims are not all petty cash). */
  const floatOffered = me.route === 'float';
  const [payBack, setPayBack] = useState<'float' | 'finance'>('float');
  const paidFromFloat = floatOffered && payBack === 'float';
  const transfer = kind === 'claim' && !paidFromFloat;
  const [bank, setBank] = useSavedBank(transfer);
  const [wrongBank, setWrongBank] = useState<keyof ClaimBank | null>(null);
  /* Claim to me */
  const [reading, setReading] = useState(false);
  const [spendDate, setSpendDate] = useState(todayMyt());
  const [vendorName, setVendorName] = useState('');
  /* Direct pay */
  /* No payment-or-deposit choice (chew, 17 Nov 2026): the bill or quotation total is paid whole, unless a deposit is
     filled in, as a percent of it or an amount; then the request is that deposit. */
  const [billTotalSen, setBillTotalSen] = useState<number | null>(seed && seed.type !== 'DEPOSIT' ? seed.amountSen : null);
  const [depositPct, setDepositPct] = useState('');
  const [depositAmtSen, setDepositAmtSen] = useState<number | null>(seed?.type === 'DEPOSIT' ? seed.amountSen : null);
  const type: 'PAYMENT' | 'DEPOSIT' = depositAmtSen != null && depositAmtSen > 0 ? 'DEPOSIT' : 'PAYMENT';
  const shareOf = (total: number | null, pct: string) => { if (pct.trim()) setDepositAmtSen(depositSen(total, pct)); };
  /* The note finance reads: the share, when the deposit is still that share of the total. */
  const depositNote = () => {
    const share = type === 'DEPOSIT' ? depositSen(billTotalSen, depositPct) : null;
    const said = share != null && share === depositAmtSen ? `Deposit ${depositPct.trim()}% of ${rm(billTotalSen!)}`
      : type === 'DEPOSIT' && billTotalSen ? `Deposit of ${rm(billTotalSen)}` : '';
    return [said, note.trim()].filter(Boolean).join(' · ');
  };
  const [supplier, setSupplier] = useState<Supplier | null>(seed?.supplierId ? { id: seed.supplierId, code: '', name: seed.payeeName } : null);
  const [poSearch, setPoSearch] = useState('');
  const [po, setPo] = useState<{ id: string; label: string } | null>(seed?.purchaseOrderId ? { id: seed.purchaseOrderId, label: 'The PO on this request' } : null);
  const poId = po?.id ?? '';
  const [payeeName, setPayeeName] = useState(seed && !seed.supplierId ? seed.payeeName : '');
  const [wantedOn, setWantedOn] = useState(wantedOnAgain(seed?.wantedOn ?? null, todayMyt()));
  const pq = poSearch.trim();
  /* A PO number typed finds it; with none typed, a supplier picked lists its own POs (chew, 25 Nov 2026). */
  const poQuery = pq.length >= 2 ? `q=${encodeURIComponent(pq)}${supplier?.id ? `&supplierId=${encodeURIComponent(supplier.id)}` : ''}`
    : supplier?.id ? `supplierId=${encodeURIComponent(supplier.id)}` : null;
  const pos = useApi<{ purchaseOrders: { id: string; poNumber: string; status: string; totalSen: number }[] }>(kind === 'direct' && poQuery ? `/claims/purchase-orders?${poQuery}` : null);

  const found = (pos.data?.purchaseOrders ?? []).map(p => ({ value: p.id, label: `${p.poNumber} · ${rm(p.totalSen)}`, totalSen: p.totalSen }));
  const poOptions: { value: string; label: string; totalSen?: number }[] = po && !found.some(o => o.value === po.id) ? [{ value: po.id, label: po.label }, ...found] : found;

  /* The receipt and the bill are different papers: switching drops the files; amount, lines and note stay. */
  /* A receipt read still running when the kind is switched (or the files are picked again) must not land: each read
     carries the number it started with, and only the latest one, still on Claim to me, fills anything. */
  const readNo = useRef(0);
  const dateTyped = useRef(false);
  const switchKind = (k: Kind) => { if (k !== kind) { readNo.current++; setReading(false); setKind(k); setFiles([]); setProblem(null); } };
  /* The form as it is NOW, for a bill read that comes back after the person changed it (a PO or supplier picked,
     a payee typed while reading): pick()'s own variables are the values from when the files were chosen. */
  const formNow = useRef({ amountSen, hasSupplierOrPo: false, payeeName, wantedOn, note, billTotalSen, depositPct });
  formNow.current = { amountSen, hasSupplierOrPo: !!supplier || !!poId, payeeName, wantedOn, note, billTotalSen, depositPct };
  /* What Direct pay asks for: the deposit when there is one, else the whole bill. */
  useEffect(() => { if (kind === 'direct') setAmountSen(type === 'DEPOSIT' ? depositAmtSen : billTotalSen); }, [kind, type, depositAmtSen, billTotalSen]);
  /* The figures the last papers read put in: papers picked again replace those, never a figure the person typed
     (chew, 17 Nov 2026: a new quotation's total did not replace the old one's). */
  const readFig = useRef<{ amountSen: number | null; totalSen: number | null }>({ amountSen: null, totalSen: null });
  const takeRead = (key: 'amountSen' | 'totalSen', now: number | null, read: number | null | undefined, set: (v: number) => void): boolean => {
    if (read == null || read <= 0 || (now != null && now !== readFig.current[key])) return false;
    readFig.current[key] = read;
    set(read);
    return true;
  };

  async function pick(list: FileList) {
    /* The papers picked replace the ones before ("Click or drop to replace"); every page of one bill is picked together. */
    const chosen = Array.from(list).slice(0, 8);
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
      /* A deposit's bill is the whole quotation: its total, of which the deposit is a share. */
      const f = formNow.current;
      if (takeRead('totalSen', f.billTotalSen, read.amountSen, setBillTotalSen)) shareOf(read.amountSen!, f.depositPct);
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
    /* A figure typed (now or while it was reading) stays; one the last papers put in is replaced. */
    takeRead('amountSen', formNow.current.amountSen, read.amountSen, setAmountSen);
    if (read.date && read.date <= todayMyt() && !dateTyped.current) setSpendDate(read.date);
    if (read.vendorName) setVendorName(v => v || read.vendorName || '');
  }

  async function send() {
    setProblem(null);
    if (!amountSen || amountSen <= 0) return setProblem(kind === 'claim' ? 'Enter the amount on the receipt.' : 'Enter the bill or quotation total.');
    if (kind === 'claim' && files.length === 0) return setProblem('Add a photo of the receipt.');
    if (kind === 'direct') {
      if (type === 'DEPOSIT' && billTotalSen != null && depositAmtSen! >= billTotalSen) return setProblem('A deposit is less than the bill: clear the deposit to pay the whole bill.');
      if (!supplier && !poId && (type === 'DEPOSIT' || !payeeName.trim())) return setProblem(type === 'DEPOSIT' ? 'A deposit is paid to a supplier on the list.' : 'Choose the supplier, a PO, or type who is paid.');
      if (files.length + kept.length === 0) return setProblem('Add the invoice, receipt or quotation.');
    }
    const built = toLines(lines, amountSen);
    if (!built.ok) return setProblem(built.message);
    const badBank = transfer ? bankProblem(bank) : null;
    if (badBank) { setWrongBank(badBank); return setProblem('Check the bank account you are paid back to.'); }
    setBusy(true);
    try {
      if (kind === 'claim') {
        const made = await postWithFiles<{ receiptNo: string; route: 'float' | 'finance' }>('/claims/receipts',
          { spendDate, amountSen, vendorName: vendorName.trim() || undefined, note: note.trim() || undefined, lines: built.lines,
            ...(transfer ? { payBack: 'finance', bank } : {}) }, files);
        toast({ tone: 'success', title: `Receipt ${made.receiptNo} handed in`, body: made.route === 'float' ? 'Your department\'s petty cash pays you back.' : 'Finance pays you back by transfer.' });
      } else {
        const body = {
          type, supplierId: supplier?.id, purchaseOrderId: poId || undefined, payeeName: !poId && !supplier ? payeeName.trim() || undefined : undefined,
          amountSen, wantedOn: wantedOn || undefined, note: depositNote() || undefined, lines: built.lines,
        };
        if (reviewing) {
          await postWithFiles(`/claims/reno-review/${reviewing.request.id}/send`, { ...body, keepFileIds: kept.map(f => f.id) }, files);
          toast({ tone: 'success', title: `Request ${reviewing.request.requestNo} sent to finance` });
          reviewing.onDone();
          return;
        }
        if (editing) {
          const again = await postWithFiles<{ renoReview: boolean }>(`/claims/requests/${editing.id}/resubmit`, { ...body, keepFileIds: kept.map(f => f.id) }, files);
          toast({ tone: 'success', title: `Request ${editing.requestNo} sent to finance again`, body: again.renoReview ? RENO_FIRST_NOTE : undefined });
        } else {
          const made = await postWithFiles<{ requestNo: string; renoReview: boolean }>('/claims/requests', body, files);
          toast({ tone: 'success', title: `Request ${made.requestNo} sent to finance`, body: made.renoReview ? RENO_FIRST_NOTE : undefined });
        }
      }
      onDone(kind === 'claim' ? spendDate.slice(0, 7) : thisMonthMyt());
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  }

  const claim = kind === 'claim';
  const keptHref = (fileId: string) => (reviewing ? renoReviewFileHref(reviewing.request.id, fileId) : requestFileHref(editing?.id ?? '', fileId));
  const papersRow = (label: string, hint: string) => (
    <>
      <FileDropRow label={kept.length ? 'Add more papers (optional)' : label} hint={hint} accept="image/*,application/pdf" multiple onPick={l => void pick(l)}
        busy={reading} compact />
      <ClaimPapers saved={kept} hrefOf={keptHref} picked={files} onRemoveSaved={fileId => setKept(k => k.filter(x => x.id !== fileId))}
        onRemovePicked={index => setFiles(list => list.filter((_, position) => position !== index))} />
    </>
  );
  const summary = (
    <Card className="p-4 flex flex-col gap-3 lg:sticky lg:top-0">
      <span className="ds-eyebrow">Summary</span>
      <KeyFacts cols={2} items={[
        ...(reviewing ? [{ label: 'Reviewing', value: reviewing.request.requestNo }] : []),
        { label: 'Hand in as', value: claim ? 'Claim to me' : 'Direct pay' },
        { label: 'Lines', value: String(lines.length) },
        { label: 'Amount', value: amountSen ? rm(amountSen) : 'Not entered' },
        { label: claim ? 'Paid back by' : 'Paid by', value: claim ? (paidFromFloat ? 'Petty cash' : 'Finance, by transfer') : 'Finance, by transfer' },
      ]} />
      <p className="m-0 text-meta text-muted-ink">
        {claim ? (paidFromFloat ? 'Your department keeps petty cash, so it pays back once the receipt is checked.' : floatOffered ? 'Finance pays this one back by bank transfer; your petty cash is not used.' : 'Your department has no petty cash: finance pays back by bank transfer.')
          : 'Finance pays the supplier after checking the bill and the payee. Finance chooses the account while checking.'}
      </p>
    </Card>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
      <Card className="claim-form-compact p-4 sm:p-5 flex flex-col gap-4">
        {reviewing ? (
          <ClaimSection title={`Reviewing ${reviewing.request.requestNo}, asked by ${reviewing.request.requesterName ?? 'someone'}`}>
            <RowHelp>Change anything that is wrong, then send it to finance, or send it back to the person who asked.</RowHelp>
            <div><Button size="sm" variant="tertiary" onClick={reviewing.onBack}>Back to the list</Button></div>
          </ClaimSection>
        ) : editing ? (
          <ClaimSection title={`Changing ${editing.requestNo}`} hint={editing.status === 'REJECTED' ? `Rejected${editing.decidedBy ? ` by ${editing.decidedBy}` : ''}` : 'Withdrawn'}>
            {editing.reason && <Problem text={editing.reason} />}
            <RowHelp>Change what is wrong and send it again. It keeps its number, and finance sees it again.</RowHelp>
            {onCancelEdit && <div><Button size="sm" variant="tertiary" onClick={onCancelEdit}>Keep it as it is</Button></div>}
          </ClaimSection>
        ) : (
          <ClaimSection title="What is this" hint={claim ? 'I paid; pay me back' : 'Finance pays a supplier'}>
            <ChoiceChips label="Hand in as" value={kind} onChange={switchKind} options={[{ value: 'claim', label: 'Claim to me' }, { value: 'direct', label: 'Direct pay' }]} />
          </ClaimSection>
        )}
        {claim ? (
          <>
          {floatOffered && (
            <ClaimSection title="Paid back by" hint={paidFromFloat ? 'Paid back from your department\'s petty cash' : 'Finance transfers it to your bank account; petty cash is not used'}>
              <ChoiceChips label="Paid back by" value={payBack} onChange={v => setPayBack(v as 'float' | 'finance')}
                options={[{ value: 'float', label: 'Petty cash' }, { value: 'finance', label: 'Finance, by transfer' }]} />
            </ClaimSection>
          )}
          <ClaimSection title="Receipt">
            {papersRow('Add the receipt', 'Photos or a PDF. The amount is read from it; check it before you send.')}
            <GridRow>
              <DateField label="Date on the receipt" required value={spendDate} onChange={v => { setSpendDate(v); dateTyped.current = true; }} max={todayMyt()} />
              <MoneyInput label="Amount" required valueSen={amountSen} onChangeSen={setAmountSen} />
              <Field label="Shop (optional)" value={vendorName} onChange={e => setVendorName(e.target.value)} maxLength={200} />
            </GridRow>
          </ClaimSection>
          </>
        ) : (
          <>
            <ClaimSection title="Who is paid">
              {/* The supplier first, then its PO (chew, 25 Nov 2026): the PO box lists the supplier's own POs, and a PO
                  picked fills the bill total with its amount. */}
              <div className={TWO_COLUMN_GRID}>
                <div className="min-w-0">
                  <SupplierPicker value={supplier} onChange={v => { setSupplier(v); if (v?.id !== supplier?.id) { setPo(null); setPoSearch(''); } }} allowNotListed={type === 'PAYMENT'} />
                </div>
                {/* The chosen PO stays an option when a new search no longer finds it, so the box never shows "Not against a
                    PO" while one is still chosen. */}
                <ComboSelect label="Purchase order (optional)" value={poId} onQueryChange={setPoSearch} placeholder="Not against a PO, or type a PO number"
                  onChange={v => {
                    const o = poOptions.find(x => x.value === v);
                    setPo(o ? { id: o.value, label: o.label } : null);
                    if (o?.totalSen != null) { setBillTotalSen(o.totalSen); shareOf(o.totalSen, depositPct); }
                  }}
                  options={[{ value: '', label: supplier && !found.length ? 'No PO for this supplier' : 'Not against a PO' }, ...poOptions]} />
                {!supplier && type === 'PAYMENT' && <Field label="Pay to (not on the list)" value={payeeName} onChange={e => setPayeeName(e.target.value)} maxLength={200} />}
              </div>
              {!supplier && type === 'PAYMENT' && <RowHelp>Finance checks the payee before paying.</RowHelp>}
            </ClaimSection>
            <ClaimSection title="Money and papers">
              {papersRow('Add the invoice, receipt or quotation', 'Photos or a PDF. Empty fields are filled from it; check them before you send.')}
              <GridRow>
                <MoneyInput label="Bill or quotation total" required valueSen={billTotalSen} onChangeSen={v => { setBillTotalSen(v); shareOf(v, depositPct); }} />
                <Field label="Deposit % (optional)" numeric inputMode="decimal" value={depositPct} trailing="%" placeholder="e.g. 50"
                  onChange={e => { setDepositPct(e.target.value); setDepositAmtSen(e.target.value.trim() ? depositSen(billTotalSen, e.target.value) : null); }} />
                <MoneyInput label="Deposit amount (optional)" valueSen={depositAmtSen} onChangeSen={v => { setDepositAmtSen(v); setDepositPct(v == null ? '' : percentOf(v, billTotalSen) ?? depositPct); }} />
              </GridRow>
              <GridRow>
                <DateField label="Pay by (optional)" value={wantedOn} onChange={setWantedOn} min={todayMyt()} />
                <p className="m-0 min-w-0 text-meta text-muted-ink sm:col-span-2 sm:self-end sm:min-h-[var(--control-height)] sm:flex sm:items-center">
                  {type === 'DEPOSIT'
                    ? `A deposit of ${rm(depositAmtSen!)}: paid before the bill, to a supplier on the list; the balance is asked for later.`
                    : 'Pays the whole bill. To pay a deposit only, fill its percent or its amount.'}
                </p>
              </GridRow>
            </ClaimSection>
          </>
        )}
        <ClaimSection title="What it was for" hint={lines.length > 1 ? 'The lines must add up to the amount' : 'Finance chooses the account while checking'}>
          <LinesEditor lines={lines} setLines={setLines} totalSen={amountSen} department={me.lineDepartment} recoverOn={kind === 'direct' ? 'paid' : 'checked'} />
        </ClaimSection>
        {transfer && (
          <ClaimSection title="Paid back to" hint="Your saved account; change it for this claim if needed">
            <GridRow className="sm:[&>span]:col-span-3">
              <ClaimBankFields bank={bank} wrong={wrongBank} t={t}
                onChange={(k, v) => { setBank(b => ({ ...b, [k]: v })); if (wrongBank === k) setWrongBank(null); }} />
            </GridRow>
          </ClaimSection>
        )}
        <ClaimSection title="Note">
          <Field label="Anything finance should know (optional)" value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
        </ClaimSection>
        {problem && <div role="alert" className={cx('px-3 py-2 rounded-control text-copy', TONE.critical.bg, TONE.critical.text)}>{problem}</div>}
        <div className={FORM_FOOTER}>
          {reviewing && <Button variant="secondary" disabled={busy} onClick={() => setIsSendingBack(true)}>Send back</Button>}
          <Button variant="primary" loading={busy} disabled={reading} disabledReason="Reading the papers first." onClick={() => void send()}>{claim ? 'Hand in' : editing ? 'Send to finance again' : 'Send to finance'}</Button>
        </div>
      </Card>
      {reviewing && (
        <ConfirmDialog onClose={() => setIsSendingBack(false)} spec={isSendingBack ? {
          title: `Send ${reviewing.request.requestNo} back`, body: 'The person who asked sees your reason and can change it and send it again.', confirmLabel: 'Send back', danger: true,
          reason: { label: 'Why is it sent back?', maxLength: 500 },
          onConfirm: async reason => {
            try {
              await api.post(`/claims/reno-review/${reviewing.request.id}/reject`, { reason: reason.trim() });
              toast({ tone: 'success', title: `Request ${reviewing.request.requestNo} sent back` });
              reviewing.onDone();
            } catch (e) { toast({ tone: 'critical', title: 'Not sent back', body: errorMessage(e) }); }
          },
        } : null} />
      )}
      <div className="max-lg:order-first max-lg:hidden">{summary}</div>
    </div>
  );
}

function Files({ r, hrefOf = receiptFileHref }: { r: { id: string; files: ClaimFile[] }; hrefOf?: (receiptId: string, fileId: string) => string }) {
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  if (!r.files.length) return <>—</>;
  return (
    <>
      {r.files.map((f, i) => (
        <button key={f.id} type="button" onClick={e => { e.stopPropagation(); setViewing(claimFileItem(f, fileId => hrefOf(r.id, fileId))); }}
          className="mr-2 p-0 border-0 bg-transparent cursor-pointer text-primary font-medium">{f.mime === 'application/pdf' ? 'PDF' : 'Photo'}{r.files.length > 1 ? ` ${i + 1}` : ''}</button>
      ))}
      {viewing && <span onClick={e => e.stopPropagation()}><MediaViewer item={viewing} onClose={() => setViewing(null)} /></span>}
    </>
  );
}

/* One paid through an AP invoice is changed on the invoice by finance, not withdrawn (chew, 15 Nov 2026). */
const canWithdraw = (q: PaymentRequest) => (q.status === 'SUBMITTED' || q.status === 'RENO_REVIEW') && q.vouchers.length === 0 && !onBill(q);

const receiptStatus = (receipt: Receipt) => ({ label: RECEIPT_STATUS[receipt.status], tone: RECEIPT_TONE[receipt.status] });
const requestStatus = (request: PaymentRequest) => ({ label: REQUEST_STATUS[request.status], tone: REQUEST_TONE[request.status] });
const paybackRoute = (receipt: Receipt) => (receipt.floatId ? 'Petty cash' : 'Finance, by transfer');
const noReceiptsIn = (month: string) => `No receipts in ${monthLabel(month, { long: true })}`;

function monthOptions(selectedMonth: string): SelectOption[] {
  const recentMonths = lastMonths(12);
  if (recentMonths.some(option => option.value === selectedMonth)) return recentMonths;
  return [...recentMonths, { value: selectedMonth, label: monthLabel(selectedMonth, { long: true }) }];
}

function TableTitle({ title, count, note }: { title: string; count?: number; note?: string }) {
  return (
    <span className="flex items-center min-h-[34px] max-md:min-h-11 min-w-0 mr-1">
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="text-heading font-semibold truncate">{title}</span>
        {count !== undefined && <span className="text-meta text-muted-ink tabular-nums">{count}</span>}
        {note && <span className="text-meta text-muted-ink whitespace-nowrap">· {note}</span>}
      </span>
    </span>
  );
}

function MonthToolbar({ title, count, month, onMonthChange }: { title: string; count?: number; month: string; onMonthChange: (month: string) => void }) {
  const months = useMemo(() => monthOptions(month), [month]);
  return (
    <ListToolbar bare className="w-full" leading={<TableTitle title={title} count={count} />}
      date={{ label: 'Month', value: month, onChange: onMonthChange, presets: months.map(m => ({ value: m.value, label: String(m.label) })) }} />
  );
}

function DetailLines({ lines, totalSen }: { lines: ClaimLine[]; totalSen: number }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="ds-eyebrow">What it was for</span>
      <MoneyLines lines={[
        ...lines.map(l => ({ label: [describeClaimLine(l), l.description].filter(Boolean).join(' · '), sen: l.amountSen })),
        ...(lines.length > 1 ? [{ label: 'Total', sen: totalSen, kind: 'total' as const }] : []),
      ]} />
    </section>
  );
}

function NoteBlock({ text }: { text: string }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="ds-eyebrow">Note</span>
      <p className="m-0 text-copy text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
    </section>
  );
}

function Papers({ files, hrefOf }: { files: ClaimFile[]; hrefOf: (fileId: string) => string }) {
  if (files.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <span className="ds-eyebrow">Papers</span>
      <ClaimPapers saved={files} hrefOf={hrefOf} picked={[]} />
    </section>
  );
}

function WrappedFact({ text }: { text: string }) {
  return <span className="whitespace-normal [overflow-wrap:anywhere]">{text}</span>;
}

function Problem({ text }: { text: string }) {
  return <div role="note" className={cx('px-3 py-2 rounded-control text-copy', TONE.critical.bg, TONE.critical.text)}>{text}</div>;
}

/** One receipt in full, for looking back at it: what was paid, what for, how it is paid back, and the photos. */
function ReceiptDetail({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  return (
    <Modal title={`Receipt ${receipt.receiptNo}`} eyebrow="My claims" size="md" onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <KeyFacts cols={2} items={[
        { label: 'Amount', value: rm(receipt.amountSen) },
        { label: 'Status', value: RECEIPT_STATUS[receipt.status] },
        { label: 'Date on the receipt', value: date(receipt.spendDate) },
        { label: 'Shop', value: <WrappedFact text={receipt.vendorName ?? '—'} /> },
        { label: 'Paid back by', value: paybackRoute(receipt) },
      ]} />
      {receipt.rejectReason && <Problem text={receipt.rejectReason} />}
      <DetailLines lines={receipt.lines} totalSen={receipt.amountSen} />
      {receipt.note && <NoteBlock text={receipt.note} />}
      <Papers files={receipt.files} hrefOf={fileId => receiptFileHref(receipt.id, fileId)} />
    </Modal>
  );
}

/** One request to finance in full; while finance has not started paying it, it can be withdrawn from here. Once withdrawn
 *  or rejected it can be changed and sent again under its own number (chew, 13 Nov 2026); one made from utility bills is
 *  fixed on Utility bills. */
function RequestDetail({ request, onClose, onWithdraw, onEdit, onBalance }: { request: PaymentRequest; onClose: () => void; onWithdraw: () => void; onEdit: () => void; onBalance: () => void }) {
  const vouchers = request.vouchers.filter(v => v.status !== 'CANCELLED').map(v => v.pvNumber).join(', ');
  const bill = billLabel(request);
  return (
    <Modal title={`Request ${request.requestNo}`} eyebrow="My claims" size="md" onClose={onClose}
      footer={<>
        {canWithdraw(request) && <Button variant="tertiary" className="mr-auto" icon={<Icon name="Undo2" size="sm" />} onClick={onWithdraw}>Withdraw</Button>}
        {canResubmit(request) && <Button variant="primary" className="mr-auto" icon={<Icon name="Pencil" size="sm" />} onClick={onEdit}>Edit and resubmit</Button>}
        {canAskBalance(request) && <Button variant="primary" className="mr-auto" icon={<Icon name="Send" size="sm" />} onClick={onBalance}>Ask for the balance</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      <KeyFacts cols={2} items={[
        { label: 'Amount', value: rm(request.amountSen) },
        { label: 'Status', value: REQUEST_STATUS[request.status] },
        { label: 'Paid to', value: <WrappedFact text={request.payeeName} /> },
        { label: 'Type', value: request.type === 'DEPOSIT' ? 'A deposit' : 'A payment' },
        { label: 'Asked on', value: date(request.createdAt) },
        { label: 'Pay by', value: request.wantedOn ? date(request.wantedOn) : 'Not set' },
        ...(request.renoReviewedBy ? [{ label: 'Reviewed by', value: request.renoReviewedBy }] : []),
        ...(vouchers ? [{ label: 'Payment voucher', value: vouchers }] : []),
        ...(bill ? [{ label: 'AP invoice', value: bill }] : []),
        ...(request.parentRequestNo ? [{ label: 'Balance of', value: request.parentRequestNo }] : []),
        ...((request.balanceRequests ?? []).length ? [{ label: 'Balance asked on', value: (request.balanceRequests ?? []).map(b => b.requestNo).join(', ') }] : []),
      ]} />
      {reasonNote(request) && (reasonNote(request)!.now ? <Problem text={reasonNote(request)!.text} /> : <p className="m-0 text-meta text-muted-ink">{reasonNote(request)!.text}</p>)}
      {updatedFromBill(request) && <p className="m-0 text-meta text-muted-ink">Updated from the invoice: finance changed it to match the supplier's invoice.</p>}
      <DetailLines lines={request.lines} totalSen={request.amountSen} />
      {updatedFromBill(request) && (
        <details className="text-meta">
          <summary className="cursor-pointer text-muted-ink">As first asked{request.askedAmountSen != null ? ` · ${rm(request.askedAmountSen)}` : ''}</summary>
          <ul className="m-0 mt-1 pl-4">
            {(request.askedLines ?? []).map((l, i) => <li key={i}>{l.description || 'Line'} · {rm(l.amountSen)}</li>)}
          </ul>
        </details>
      )}
      {request.note && <NoteBlock text={request.note} />}
      <Papers files={request.files} hrefOf={fileId => requestFileHref(request.id, fileId)} />
      {request.status === 'RENO_REVIEW' && <p className="m-0 text-meta text-muted-ink">Waiting for the renovation reviewer before finance sees it.</p>}
      {canWithdraw(request) && <p className="m-0 text-meta text-muted-ink">Finance has not started paying it, so you can still withdraw it.</p>}
      {canResubmit(request) && <p className="m-0 text-meta text-muted-ink">Change what is wrong and send it again. It keeps its number.</p>}
      {fixOnUtilityBills(request) && <p className="m-0 text-meta text-muted-ink">Made from utility bills: fix the bills on Utility bills, then use Send again there.</p>}
      {canAskBalance(request) && <p className="m-0 text-meta text-muted-ink">The deposit is paid. Ask for the balance ({rm(balanceSen(request))}) when the work is done: nothing to fill in again.</p>}
    </Modal>
  );
}

/** Ask for the balance of a paid deposit (chew, 15 Nov 2026), nothing filled in again; the supplier's formal invoice may
 *  come with it (chew, 16 Nov 2026), for finance to replace the quotation with. */
function BalanceDialog({ request, onClose, onSent }: { request: PaymentRequest; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setProblem(null);
    try {
      const made = await postWithFiles<{ requestNo: string }>(`/claims/requests/${request.id}/balance`, {}, files);
      toast({ tone: 'success', title: `Balance asked for on ${made.requestNo}`, body: files.length ? 'The formal invoice goes to finance with it.' : undefined });
      onSent();
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Ask for the balance of ${request.requestNo}`} eyebrow="My claims" size="md" onClose={onClose} busy={busy} dirty={files.length > 0}
      footer={<>
        <Button variant="secondary" className="mr-auto" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => void send()}>Ask for the balance</Button>
      </>}>
      <p className="m-0 text-copy">
        Finance is asked to pay {request.payeeName} the rest of {billLabel(request) ?? 'the invoice'}: <b className="tabular-nums">{rm(balanceSen(request))}</b>.
        The lines, projects and units come from the invoice; nothing to fill in again.
      </p>
      <FileDropRow label="Attach the formal invoice (optional)" hint="Photos or a PDF. Finance replaces the quotation with it." accept="image/*,application/pdf" multiple
        onPick={l => setFiles(f => [...f, ...Array.from(l)].slice(0, 8))} chosen={files.length ? files.map(f => f.name).join(', ') : null} disabled={busy} />
      {files.length > 0 && <div><Button variant="tertiary" size="sm" onClick={() => setFiles([])} disabled={busy}>Remove the files</Button></div>}
      {problem && <Problem text={problem} />}
    </Modal>
  );
}

function Mine({ month, onMonthChange, onHandIn, onEdit }: { month: string; onMonthChange: (month: string) => void; onHandIn: (kind: Kind) => void; onEdit: (q: PaymentRequest) => void }) {
  const receipts = useApi<{ receipts: Receipt[] }>(`/claims/receipts?month=${month}`);
  const requests = useApi<{ requests: PaymentRequest[] }>('/claims/requests');
  const toast = useToast();
  const [withdraw, setWithdraw] = useState<PaymentRequest | null>(null);
  const [balance, setBalance] = useState<PaymentRequest | null>(null);
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);
  const [openRequest, setOpenRequest] = useState<PaymentRequest | null>(null);
  const rCols: Column<Receipt>[] = [
    { key: 'date', label: 'Date', type: 'date', value: r => r.spendDate },
    { key: 'no', label: 'Receipt', value: r => r.receiptNo },
    { key: 'shop', label: 'Shop', value: r => r.vendorName ?? '', sub: r => r.lines.map(l => l.description).filter(Boolean).join('; ') },
    { key: 'amount', label: 'Amount', type: 'money', value: r => r.amountSen },
    { key: 'status', label: 'Status', type: 'status', status: receiptStatus, sub: r => r.rejectReason ?? paybackRoute(r) },
  ];
  const qCols: Column<PaymentRequest>[] = [
    { key: 'on', label: 'Asked on', type: 'date', value: q => q.createdAt, phone: 'meta' },
    { key: 'no', label: 'Request', value: q => q.requestNo },
    { key: 'pay', label: 'Paid to', value: q => q.payeeName, sub: q => (q.type === 'DEPOSIT' ? 'Deposit' : null), phone: 'title' },
    { key: 'amount', label: 'Amount', type: 'money', value: q => q.amountSen },
    { key: 'status', label: 'Status', type: 'status', status: requestStatus, sub: q => {
      // The reason now while rejected; once sent again, its vouchers, else "Rejected before" (review, 13 Nov 2026).
      const note = reasonNote(q), pvs = q.vouchers.filter(v => v.status !== 'CANCELLED').map(v => v.pvNumber).join(', ');
      return note?.now ? note.text : pvs || billLabel(q) || note?.text || '';
    } },
    {
      key: 'act', label: '', value: () => '', phone: 'hide', noExport: true,
      render: q => (canWithdraw(q) ? (
        <Button variant="secondary" size="sm" icon={<Icon name="Undo2" size="sm" />} onClick={e => { e.stopPropagation(); setWithdraw(q); }}>Withdraw</Button>
      ) : canResubmit(q) ? (
        <Button variant="secondary" size="sm" icon={<Icon name="Pencil" size="sm" />} onClick={e => { e.stopPropagation(); onEdit(q); }}>Edit and resubmit</Button>
      ) : canAskBalance(q) ? (
        <Button variant="secondary" size="sm" icon={<Icon name="Send" size="sm" />} onClick={e => { e.stopPropagation(); setBalance(q); }}>Ask for the balance</Button>
      ) : null),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <DataTable id="my-claims-receipts" toolbar={<MonthToolbar title="My receipts" count={receipts.data?.receipts.length} month={month} onMonthChange={onMonthChange} />} columns={rCols} rows={receipts.data?.receipts ?? null} rowKey={r => r.id} loading={receipts.loading} error={receipts.error} onRetry={receipts.reload}
        onRowClick={setOpenReceipt} empty={{ title: noReceiptsIn(month), body: 'Receipts are listed by the date on the receipt.', action: { label: 'Hand in a receipt', onClick: () => onHandIn('claim') } }} />
      <DataTable id="my-claims-requests" toolbar={<TableTitle title="Asked finance to pay" count={requests.data?.requests.length} note="all months" />} columns={qCols} rows={requests.data?.requests ?? null} rowKey={q => q.id} loading={requests.loading} error={requests.error} onRetry={requests.reload}
        onRowClick={setOpenRequest} empty={{ title: 'Nothing asked yet', action: { label: 'Ask finance to pay', onClick: () => onHandIn('direct') } }} />
      {openReceipt && <ReceiptDetail receipt={openReceipt} onClose={() => setOpenReceipt(null)} />}
      {openRequest && <RequestDetail request={openRequest} onClose={() => setOpenRequest(null)}
        onWithdraw={() => setWithdraw(openRequest)} onEdit={() => { const q = openRequest; setOpenRequest(null); onEdit(q); }}
        onBalance={() => setBalance(openRequest)} />}
      {balance && <BalanceDialog request={balance} onClose={() => setBalance(null)}
        onSent={() => { setBalance(null); setOpenRequest(null); requests.reload(); }} />}
      <ConfirmDialog onClose={() => setWithdraw(null)} spec={withdraw && {
        title: `Withdraw ${withdraw.requestNo}?`,
        body: 'Finance has not paid it yet. Withdrawing removes it from their list; you can ask again later.',
        confirmLabel: 'Withdraw request', busyLabel: 'Withdrawing', danger: true,
        onConfirm: async () => {
          try {
            await api.post(`/claims/requests/${withdraw.id}/withdraw`, {});
            toast({ tone: 'success', title: `${withdraw.requestNo} withdrawn` });
            setOpenRequest(null);
            requests.reload();
          } catch (e) {
            toast({ tone: 'critical', title: 'Not withdrawn', body: errorMessage(e) });
          } finally {
            setWithdraw(null);
          }
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
    { key: 'status', label: 'Status', type: 'status', status: receiptStatus, sub: r => r.rejectReason },
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
              /* A payment request to finance, made out to me (chew, 26 Nov 2026). */
              try { const r = await api.post<{ requestNo: string }>('/claims/float/top-up-request', {}); toast({ tone: 'success', title: `Payment request ${r.requestNo} sent to finance`, body: 'It lists on Payment requests; once paid the float is back to its amount.' }); q.reload(); }
              catch (e) { toast({ tone: 'critical', title: 'Not sent', body: errorMessage(e) }); }
            }}>{f.topUpRequested ? `Top-up asked for${f.topUpRequestNo ? ` (${f.topUpRequestNo})` : ''}` : 'Ask for a top-up'}</Button></div>
          </Card>
        </div>
      )}
      <DataTable id="my-claims-float" toolbar={<MonthToolbar title="Receipts on the float" count={q.data?.receipts.length} month={month} onMonthChange={setMonth} />} columns={cols} rows={q.data?.receipts ?? null} rowKey={r => r.id} loading={q.loading} error={q.error} onRetry={q.reload}
        empty={{ title: noReceiptsIn(month) }} />
    </div>
  );
}

function RenoReview({ onOpen }: { onOpen: (request: PaymentRequest) => void }) {
  const queue = useApi<{ requests: PaymentRequest[] }>('/claims/reno-review');
  const cols: Column<PaymentRequest>[] = [
    { key: 'on', label: 'Asked on', type: 'date', value: q => q.createdAt, phone: 'meta' },
    { key: 'by', label: 'Asked by', value: q => q.requesterName ?? '', phone: 'title' },
    { key: 'pay', label: 'Paid to', value: q => q.payeeName, sub: q => q.lines.map(l => l.description).filter(Boolean).join('; ') },
    { key: 'amount', label: 'Amount', type: 'money', value: q => q.amountSen },
    { key: 'files', label: 'Papers', value: q => q.files.length, render: q => <Files r={q} hrefOf={renoReviewFileHref} /> },
  ];
  return (
      <DataTable id="my-claims-reno-review" toolbar={<TableTitle title="Waiting for your review" count={queue.data?.requests.length} />} columns={cols} rows={queue.data?.requests ?? null} rowKey={q => q.id}
        loading={queue.loading} error={queue.error} onRetry={queue.reload} onRowClick={onOpen} empty={{ title: 'Nothing to review', body: 'Renovation Direct pay requests show here before finance.' }} />
  );
}
