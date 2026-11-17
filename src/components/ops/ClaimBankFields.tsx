import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { cx } from '../../lib/design-tokens';
import { myBank, type ClaimBank } from '../../lib/claims';
import type { PortalStrings } from '../../lib/portalI18n';
import { MALAYSIAN_BANKS } from '../../../functions/_lib/hrFields';
import { FormRow, INPUT } from './OpsUi';

export const NO_BANK: ClaimBank = { bankName: '', accountNo: '', accountName: '' };

/** The bank a Direct Claim to Me is paid to (chew, 12 Nov 2026), filled once from the person's saved details the first
 *  time `active` is true (finance's record, else HR's: GET /api/claims/my-bank). Only the empty fields are filled, and
 *  the person may change any of them; the change stays on the claim, never on the saved records. */
export function useSavedBank(active: boolean): [ClaimBank, Dispatch<SetStateAction<ClaimBank>>] {
  const [bank, setBank] = useState<ClaimBank>(NO_BANK);
  const asked = useRef(false);
  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    void myBank().then(saved => {
      if (saved) setBank(b => ({ bankName: b.bankName || saved.bankName, accountNo: b.accountNo || saved.accountNo, accountName: b.accountName || saved.accountName }));
    });
  }, [active]);
  return [bank, setBank];
}

/** The bank, the account number and the name on the account, with the note that changes stay on this claim. Shared by
 *  the job's Claim box (JobClaimBox) and the phone's Receipts page, so both ask the same way. */
export function ClaimBankFields({ bank, onChange, wrong, t, touch }: {
  bank: ClaimBank; onChange: (k: keyof ClaimBank, v: string) => void; wrong: keyof ClaimBank | null; t: PortalStrings; touch?: boolean;
}) {
  const p = t.claimPay;
  const field = cx(INPUT, touch && 'h-11 text-[16px]');
  /* A saved bank written another way than the list (HR typed it) is kept as it is, at the top of the list. */
  const banks = useMemo<string[]>(() => (bank.bankName && !(MALAYSIAN_BANKS as readonly string[]).includes(bank.bankName)
    ? [bank.bankName, ...MALAYSIAN_BANKS] : [...MALAYSIAN_BANKS]), [bank.bankName]);
  return (
    <>
      <FormRow label={p.bank} error={wrong === 'bankName' ? p.bankWrong.bankName : null}>
        <select className={field} value={bank.bankName} onChange={e => onChange('bankName', e.target.value)}>
          <option value="">{p.bankPick}</option>
          {banks.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </FormRow>
      <FormRow label={p.accountNo} error={wrong === 'accountNo' ? p.bankWrong.accountNo : null}>
        <input className={field} inputMode="numeric" autoComplete="off" value={bank.accountNo} onChange={e => onChange('accountNo', e.target.value)} />
      </FormRow>
      <FormRow label={p.accountName} error={wrong === 'accountName' ? p.bankWrong.accountName : null}>
        <input className={field} autoComplete="off" value={bank.accountName} onChange={e => onChange('accountName', e.target.value)} />
      </FormRow>
      <span className="text-meta text-muted-ink">{p.bankNote}</span>
    </>
  );
}
