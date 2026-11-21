// The lists behind Unmatched payments (ported from Houzs). Every rule lives on the server (backend
// acc/unmatched-payments, acc/unmatched-bank-lines); this is transport only.

import { useQuery } from '@tanstack/react-query';
import { authedFetch } from '../../vendor/scm/lib/authed-fetch';
import { retryUnlessClientError } from '../../lib/retryPolicy';

/** Where an unmatched customer payment is stuck. */
export type UnmatchedState =
  | 'CARD_NOT_REPORTED'
  | 'CARD_TO_CONFIRM'
  | 'WAITING_CONFIRMATION'
  | 'CONFIRMED_NOT_POSTED'
  | 'NOT_MATCHED'
  | 'NO_STATEMENT';

export type UnmatchedPayment = {
  source: 'SOPAY' | 'SIPAY';
  paymentId: string;
  docNo: string;
  customerName: string | null;
  salespersonName: string | null;
  collectedByName: string | null;
  paidOn: string;
  method: string;
  kind: 'card' | 'transfer' | 'cash';
  /** card: the bank it was keyed with; transfer: its sub-type. */
  channel: string | null;
  amountSen: number;
  reference: string | null;
  orNumber: string | null;
  ageDays: number;
  state: UnmatchedState;
  bankAccountCode: string | null;
  statementUpTo: string | null;
  jeNo: string | null;
};

export type BankLineWhat = 'CARD' | 'IN' | 'OUT';

export type UnmatchedBankLine = {
  lineId: number;
  statementId: number;
  accountCode: string;
  bankName: string | null;
  bookedOn: string;
  month: string;
  description: string;
  reference: string | null;
  /** Signed: positive is money in. */
  amountSen: number;
  what: BankLineWhat;
  kind: string;
  acquirerCode: string | null;
  note: string | null;
  entryCount: number;
  entries: Array<{ jeNo: string; entryDate: string; doc: string | null; who: string | null; daysApart: number }>;
  ageDays: number;
};

type Window<T> = { from: string; to: string; rows: T[] };

/** `enabled` false while the dates cannot make a window (From after To). */
export const useUnmatchedPayments = (from: string, to: string, enabled = true) => useQuery({
  queryKey: ['unmatched-payments', from, to],
  queryFn: () => authedFetch<Window<UnmatchedPayment>>(`/accounting/unmatched-payments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  enabled,
  staleTime: 30_000,
  retry: retryUnlessClientError,
  retryDelay: 800,
});

export const useUnmatchedBankLines = (from: string, to: string, enabled = true) => useQuery({
  queryKey: ['unmatched-bank-lines', from, to],
  queryFn: () => authedFetch<Window<UnmatchedBankLine>>(`/accounting/unmatched-bank-lines?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  enabled,
  staleTime: 30_000,
  retry: retryUnlessClientError,
  retryDelay: 800,
});
