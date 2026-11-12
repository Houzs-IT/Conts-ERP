/**
 * The bank a Direct Claim to Me is paid to (chew, 12 Nov 2026): prefilled from the person's saved details and changed
 * on the claim only. A claim never writes the saved records ("不要碰我这里保存的银行记录"). The rules are the engine's
 * (engine/backend/src/conts/my-claims-routes.ts claimBank); the forms and the job's documents route check them first, so
 * the person hears which field is wrong before anything is sent.
 */
export interface ClaimBank { bankName: string; accountNo: string; accountName: string }

/** The first field that is wrong, in the order of the form, or null when the bank can be sent. The account number is
 *  digits only, 5 to 30 of them, once spaces and dashes are dropped. */
export function bankProblem(b: Partial<ClaimBank> | null | undefined): keyof ClaimBank | null {
  const bankName = String(b?.bankName ?? '').trim();
  const accountNo = String(b?.accountNo ?? '').replace(/[\s-]/g, '');
  const accountName = String(b?.accountName ?? '').trim();
  if (!bankName || bankName.length > 60) return 'bankName';
  if (!/^\d{5,30}$/.test(accountNo)) return 'accountNo';
  if (!accountName || accountName.length > 100) return 'accountName';
  return null;
}
