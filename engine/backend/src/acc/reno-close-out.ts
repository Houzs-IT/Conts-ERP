// ----------------------------------------------------------------------------
// The renovation close-out check (finance, chew 2026-10-20 SOP 4.2.2; deposits
// by project, chew 2 Nov 2026; plan docs/superpowers/plans/2026-11-02-
// renovation-close-out.md Task 3). A handed-over project is Closed only when
//   1. every instalment is invoiced and the revised contract is all received;
//   2. its suppliers are paid: every PO fully billed and every bill paid (the 5%
//      retention included, so a PO is open until retention is billed and paid),
//      and every AP invoice line on it paid;
//   3. its building deposit is back: the project's balance on 330-0040 is nil;
//   4. its advance sub-account is cleared.
// Worked out on each read from the project status figures (acc/reno-projects),
// stored nowhere; nobody clicks Closed. Unknown (a deposit from before go-live
// the opening deposits have not tagged yet) is not closed.
// ----------------------------------------------------------------------------

export const RENOVATION_DEPOSIT_ACCOUNT = '330-0040';

export interface CloseOutInput {
  allInstalmentsBilled: boolean; notInvoicedSen: number; notReceivedSen: number;
  /** A contract with no project cannot be checked for its suppliers or its deposit. */
  hasProject: boolean;
  owedToSuppliersSen: number; orderedNotBilledSen: number;
  /** False when the contract was signed before the ledger start and no opening deposits are in the books. */
  depositKnown: boolean; depositLeftSen: number;
  hasAdvanceAccount: boolean; advanceLeftSen: number;
}
export type CloseOutKey = 'billed' | 'suppliers' | 'deposit' | 'advance';
export interface CloseOutCheck { key: CloseOutKey; ok: boolean | null; text: string }
export interface CloseOut { closed: boolean; checks: CloseOutCheck[] }

const rm = (sen: number): string => `RM ${(Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function closeOutOf(i: CloseOutInput): CloseOut {
  const billedLeft = [
    i.notInvoicedSen > 0 ? `${rm(i.notInvoicedSen)} not yet invoiced` : null,
    i.notReceivedSen > 0 ? `${rm(i.notReceivedSen)} not yet received` : null,
  ].filter(Boolean).join('; ');
  const billed: CloseOutCheck = billedLeft
    ? { key: 'billed', ok: false, text: billedLeft }
    : !i.allInstalmentsBilled ? { key: 'billed', ok: false, text: 'An instalment is not invoiced yet' }
    : { key: 'billed', ok: true, text: 'Done' };
  const supplierLeft = [
    i.owedToSuppliersSen > 0 ? `${rm(i.owedToSuppliersSen)} owed to suppliers` : null,
    i.orderedNotBilledSen > 0 ? `${rm(i.orderedNotBilledSen)} ordered, not billed` : null,
  ].filter(Boolean).join('; ');
  const suppliers: CloseOutCheck = !i.hasProject ? { key: 'suppliers', ok: null, text: 'No project: suppliers not checked' } : supplierLeft ? { key: 'suppliers', ok: false, text: supplierLeft } : { key: 'suppliers', ok: true, text: 'Done' };
  const deposit: CloseOutCheck = !i.hasProject ? { key: 'deposit', ok: null, text: 'No project: deposit not checked' } : !i.depositKnown
    ? { key: 'deposit', ok: null, text: 'Deposit unknown: opening deposits not uploaded' }
    : i.depositLeftSen > 0 ? { key: 'deposit', ok: false, text: `${rm(i.depositLeftSen)} deposit not returned` }
    : i.depositLeftSen < 0 ? { key: 'deposit', ok: false, text: `${rm(i.depositLeftSen)} more returned than paid` }
    : { key: 'deposit', ok: true, text: 'Done' };
  const advance: CloseOutCheck = !i.hasAdvanceAccount
    ? { key: 'advance', ok: null, text: 'No advance account: seed the contract at go-live' }
    : i.advanceLeftSen !== 0 ? { key: 'advance', ok: false, text: `${rm(i.advanceLeftSen)} left in the advance` }
    : { key: 'advance', ok: true, text: 'Done' };
  const checks = [billed, suppliers, deposit, advance];
  return { closed: checks.every((c) => c.ok === true), checks };
}
