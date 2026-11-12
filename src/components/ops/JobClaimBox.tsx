import { useState } from 'react';
import { Button } from '../Button';
import { FileDropRow } from '../Attachments';
import { MoneyInput } from '../inputs';
import { useToast } from '../Toast';
import { errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import { bankProblem, readReceipt, type ClaimBank } from '../../lib/claims';
import { todayMyt } from '../../lib/format';
import type { PortalStrings } from '../../lib/portalI18n';
import { Segmented, uploadTo } from './OpsUi';
import { ClaimBankFields, useSavedBank } from './ClaimBankFields';

interface Picked { id: string; file: File; amountSen: number | null; typed: boolean; spendDate: string | null; reading: boolean }

/**
 * The job's Claim box (chew, 12 Nov 2026), the same on the phone's job sheet (FieldRepairsPage) and the desk's job page
 * (MaintenancePage): the invoice for something the person paid for the job, its amount, and how it is paid back.
 *   Petty Cash (Claim), the default — from the person's petty cash (their own float, else their department's).
 *   Direct Claim to Me — finance transfers it to the bank confirmed here; no petty cash is touched. The bank is
 *   prefilled from the person's saved details and can be changed; the change stays on this claim (the saved records are
 *   never written, chew's rule).
 * The invoice and the amount are required. The amount is read from the photo without waiting: the person may type it
 * while it reads, and a typed amount is never overwritten. Sent as POST /api/maintenance/issues/:id/documents, kind
 * purchase (the document and the receipt share one id, so sending again after a lost reply makes no second receipt).
 */
export function JobClaimBox({ jobId, route, t, touch, onDone }: {
  jobId: string;
  /** Where the person's receipts go (GET /api/claims/me): 'finance' when they have no petty cash, and then only Direct
   *  Claim to Me is offered; null while unknown. */
  route: 'float' | 'finance' | null;
  t: PortalStrings;
  /** The phone's larger touch targets. */
  touch?: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const p = t.claimPay;
  const tr = t.repairs;
  const pettyCashOffered = route !== 'finance';
  const [choice, setChoice] = useState<'float' | 'finance'>('float');
  const payBack = pettyCashOffered ? choice : 'finance';
  const [picked, setPicked] = useState<Picked | null>(null);
  // The saved details fill the empty fields once, when Direct Claim to Me is first shown.
  const [bank, setBank] = useSavedBank(payBack === 'finance');
  const [wrong, setWrong] = useState<keyof ClaimBank | null>(null);
  const [busy, setBusy] = useState(false);
  const setField = (k: keyof ClaimBank, v: string) => { setBank(b => ({ ...b, [k]: v })); if (wrong === k) setWrong(null); };

  function pick(list: FileList) {
    const file = list[0];
    if (!file) return;
    const id = crypto.randomUUID();
    setPicked({ id, file, amountSen: null, typed: false, spendDate: null, reading: true });
    void readReceipt([file]).then(read => setPicked(c => (c && c.id === id ? {
      ...c, reading: false,
      amountSen: c.typed ? c.amountSen : read.amountSen ?? c.amountSen,
      // A date read the wrong way round can land in the future; then the day it is handed in is used.
      spendDate: read.date && read.date <= todayMyt() ? read.date : c.spendDate,
    } : c)));
  }

  async function handIn() {
    if (!picked?.amountSen || picked.amountSen <= 0) return;
    const bad = payBack === 'finance' ? bankProblem(bank) : null;
    if (bad) { setWrong(bad); return; }
    setBusy(true);
    try {
      const res = await uploadTo(`/maintenance/issues/${jobId}/documents`, {
        kind: 'purchase', receiptId: picked.id, amountSen: String(picked.amountSen), ...(picked.spendDate ? { spendDate: picked.spendDate } : {}),
        ...(payBack === 'finance' ? { payBack: 'finance', bankName: bank.bankName, accountNo: bank.accountNo, accountName: bank.accountName } : {}),
      })(picked.file) as { receipt?: unknown; message?: string | null };
      // Kept for another try: the same id finds the saved document and hands the receipt in once.
      if (res.receipt === 'failed') toast({ tone: 'warning', title: tr.notHandedIn, body: res.message ?? undefined });
      else { toast({ tone: 'success', title: tr.handedIn, body: payBack === 'finance' ? p.directSent : undefined }); setPicked(null); }
    } catch (e) { toast({ tone: 'critical', title: t.jobs.notSaved, body: errorMessage(e, t.jobs.checkSignal) }); }
    finally { setBusy(false); onDone(); }
  }

  const size = touch ? 'touch' : undefined;
  return (
    <div className="flex flex-col gap-2">
      {pettyCashOffered && (
        <Segmented label={p.label} className={cx('self-start', touch && '[&>button]:h-11')} value={choice} onChange={v => { setChoice(v); setWrong(null); }}
          options={[{ value: 'float', label: p.pettyCash }, { value: 'finance', label: p.direct }]} />
      )}
      <span className="text-meta text-muted-ink">{!pettyCashOffered ? p.noFloatNote : payBack === 'finance' ? p.directNote : p.pettyCashNote}</span>
      {!picked ? (
        <FileDropRow label={tr.addInvoice} hint={tr.purchaseHint} accept="image/*,application/pdf" onPick={pick} />
      ) : (
        <div className="flex flex-col gap-2.5 rounded-control bg-muted px-3 py-3">
          <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">{picked.file.name}{picked.reading ? ` · ${tr.reading}` : ''}</span>
          <MoneyInput label={tr.purchaseAmount} valueSen={picked.amountSen} onChangeSen={v => setPicked(c => (c ? { ...c, amountSen: v, typed: true } : c))} />
          {payBack === 'finance' && <ClaimBankFields bank={bank} onChange={setField} wrong={wrong} t={t} touch={touch} />}
          <span className="flex gap-2 flex-wrap">
            <Button size={size} variant="primary" loading={busy} disabled={busy || !picked.amountSen} disabledReason={tr.needAmount} onClick={() => void handIn()}>{tr.handIn}</Button>
            <Button size={size} variant="secondary" disabled={busy} onClick={() => { setPicked(null); setWrong(null); }}>{t.common.back}</Button>
          </span>
        </div>
      )}
    </div>
  );
}
