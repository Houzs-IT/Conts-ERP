// Conts only (not part of Houzs's code): the journals petty cash makes (SOP 6; design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.5). Money paid to a keeper is an ordinary
// payment voucher (Dr petty cash, Cr bank). A receipt on a float is booked when finance checks it: Dr each line's
// account, Cr petty cash. A rejected receipt the person never repays is written off to an account finance picks.
// Each float books to its own account in the chart (chew 29 Oct 2026), e.g. 315-0101 PETTY CASH - AMIN for Maintenance.
import { postJournal, type PostJournalResult } from '../acc/engine';
import { type RuleLine } from '../acc/rules';
import { loadLedgerSettings } from '../acc/ledger-settings';
/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in acc/engine.ts */

export interface ReceiptLineForJournal { accountCode: string; amountSen: number; department: string; description?: string | null; projectId?: number | null }

/** The engine has no month close yet: a spend dated before the books start is booked on the start date. */
async function bookingDate(sb: any, companyId: number, date: string): Promise<string> {
  const ls = await loadLedgerSettings(sb, companyId);
  const start = ls.ok ? ls.settings.ledgerStartDate : null;
  return start && date < start ? start : date;
}

/** Until finance gives the float its account, nothing is booked: the receipt waits. */
const NOT_SET: PostJournalResult = { ok: false, status: 'account_invalid', reason: "Choose this float's account first (Petty cash, the float's settings)." };

const dept = (d: string): RuleLine['department'] => (d === 'rental' || d === 'supply' || d === 'shared' ? d : 'shared');

export async function postReceiptJournal(sb: any, companyId: number,
  r: { receiptNo: string; spendDate: string; floatAccountCode: string | null; lines: ReceiptLineForJournal[] }): Promise<PostJournalResult> {
  if (!r.floatAccountCode) return NOT_SET;
  const total = r.lines.reduce((n, l) => n + l.amountSen, 0);
  const lines: RuleLine[] = [
    ...r.lines.map(l => ({ accountCode: l.accountCode, debitSen: l.amountSen, creditSen: 0, department: dept(l.department), notes: l.description ?? undefined, projectId: l.projectId ?? null })),
    { accountCode: r.floatAccountCode, debitSen: 0, creditSen: total },
  ];
  return postJournal(sb, {
    companyId, entryDate: await bookingDate(sb, companyId, r.spendDate), sourceType: 'CLM', sourceDocNo: r.receiptNo,
    narration: `Petty cash receipt ${r.receiptNo}`, lines,
  });
}

export async function postWriteOffJournal(sb: any, companyId: number,
  r: { receiptNo: string; amountSen: number; accountCode: string; date: string; floatAccountCode: string | null }): Promise<PostJournalResult> {
  if (!r.floatAccountCode) return NOT_SET;
  return postJournal(sb, {
    companyId, entryDate: await bookingDate(sb, companyId, r.date), sourceType: 'CLW', sourceDocNo: r.receiptNo,
    narration: `Petty cash receipt ${r.receiptNo} written off`,
    lines: [{ accountCode: r.accountCode, debitSen: r.amountSen, creditSen: 0 }, { accountCode: r.floatAccountCode, debitSen: 0, creditSen: r.amountSen }],
  });
}
