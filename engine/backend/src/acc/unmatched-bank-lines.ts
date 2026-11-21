// ----------------------------------------------------------------------------
// unmatched-bank-lines — bank statement lines nothing in the books is matched to
// or explained by yet: the second list on Unmatched payments. Ported from Houzs
// (acc/unmatched-bank-lines.ts) and cut to what Conts has.
//
// A line is listed while it is OPEN (not POSTED, not IGNORED — a repeat of a
// movement another file recorded is set IGNORED at upload) and dated in the
// window. What each one IS comes from Bank recon's own decider, read live the
// way a statement reads it (freshDecisions in scm/routes/accounting-bank.ts):
//   CARD — money in that is an acquirer's payout (PAYOUT, PAYOUT_SPLIT,
//          PAYOUT_UNSURE, PAYOUT_NO_BATCH): the matcher's clue says which
//          merchant report it waits for;
//   IN   — any other money in: the entries of the same amount within the
//          matching window that no bank line holds yet (acc/bank-match
//          entryCandidatesFor); none means its receipt is not in the books;
//   OUT  — money out, the same way: none means its payment is not in the books.
// Houzs' DuitNow QR money is not a Conts kind and is left out.
// ----------------------------------------------------------------------------

import { ENTRY_MATCH_WINDOW_DAYS } from './bank-match';
import { dayGap } from './unmatched-payments';

export type BankLineWhat = 'CARD' | 'IN' | 'OUT';

/** One OPEN line, as Bank recon decides it today. */
export type DecidedBankLine = {
  id: number;
  statementId: number;
  accountCode: string;
  bookedOn: string;
  description: string;
  reference: string | null;
  /** Signed: positive is money in. */
  amountSen: number;
  /** The live decision: PAYOUT* or OTHER. */
  kind: string;
  acquirerCode: string | null;
  /** The decider's own sentence for it. */
  note: string | null;
};

/** An entry in the books this money could be. */
export type EntryOffer = { jeNo: string; entryDate: string; doc: string | null; who: string | null; daysApart: number };

export type UnmatchedBankLine = {
  lineId: number;
  statementId: number;
  accountCode: string;
  bankName: string | null;
  bookedOn: string;
  /** YYYY-MM — the month Bank recon opens it in. */
  month: string;
  description: string;
  reference: string | null;
  amountSen: number;
  what: BankLineWhat;
  kind: string;
  acquirerCode: string | null;
  /** Why it is still open, in one sentence. */
  note: string | null;
  /** IN / OUT: how many same-amount entries no bank line holds, and the first few. */
  entryCount: number;
  entries: EntryOffer[];
  ageDays: number;
};

/** How many of a line's possible entries the list names. */
export const MAX_ENTRY_OFFERS = 3;

export const whatOf = (kind: string, amountSen: number): BankLineWhat =>
  (amountSen < 0 ? 'OUT' : kind.startsWith('PAYOUT') ? 'CARD' : 'IN');

const shownDay = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** An IN or OUT line's sentence: the entries of its amount it could be, or that there is none. */
export function entryWords(offers: readonly EntryOffer[], what: 'IN' | 'OUT'): string {
  const first = offers.at(0);
  if (first === undefined) {
    return `No entry of this amount in the books within ${ENTRY_MATCH_WINDOW_DAYS} days of it — ${what === 'IN' ? 'record the receipt' : 'record the payment'} first.`;
  }
  if (offers.length === 1) {
    const who = [first.doc, first.who].filter(Boolean).join(' · ') || first.jeNo;
    return `One entry of this amount: ${who}, ${shownDay(first.entryDate)} — match it on Bank recon.`;
  }
  return `${offers.length} entries of this amount within ${ENTRY_MATCH_WINDOW_DAYS} days — pick the right one on Bank recon.`;
}

/** The list, oldest first — the money that has waited longest is the one to chase. */
export function unmatchedBankLinesOf(
  lines: readonly DecidedBankLine[],
  offersOf: (line: DecidedBankLine) => readonly EntryOffer[],
  bankNameOf: (accountCode: string) => string | null,
  today: string,
): UnmatchedBankLine[] {
  return lines
    .filter((l) => l.amountSen !== 0)
    .map((l): UnmatchedBankLine => {
      const what = whatOf(l.kind, l.amountSen);
      const offers = what === 'CARD' ? [] : offersOf(l);
      return {
        lineId: l.id,
        statementId: l.statementId,
        accountCode: l.accountCode,
        bankName: bankNameOf(l.accountCode),
        bookedOn: l.bookedOn,
        month: l.bookedOn.slice(0, 7),
        description: l.description,
        reference: l.reference,
        amountSen: l.amountSen,
        what,
        kind: l.kind,
        acquirerCode: l.acquirerCode,
        note: what === 'CARD' ? l.note : entryWords(offers, what),
        entryCount: offers.length,
        entries: offers.slice(0, MAX_ENTRY_OFFERS),
        ageDays: dayGap(l.bookedOn, today),
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays || a.accountCode.localeCompare(b.accountCode) || a.lineId - b.lineId);
}
