/* Unmatched payments (ported from Houzs, cut to Conts: two lists). Pinned: the two lists under one date range, each
   card with its count and money; the chips narrow a list by where each row is stuck; every payment row links the screen
   that unsticks it; a From after the To asks nothing and says so; PDF prints what the table shows. The rules are the
   server's (backend/tests/unmatchedPayments.test.ts, unmatchedBankLines.test.ts). */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UnmatchedBankLine, UnmatchedPayment } from './unmatched-payments-queries';

const { asked, printed, PAYMENTS, LINES } = vi.hoisted(() => {
  const pay = (paymentId: string, over: Partial<UnmatchedPayment>): UnmatchedPayment => ({
    source: 'SOPAY', paymentId, docNo: 'SO-1', customerName: 'Kim', salespersonName: null, collectedByName: null,
    paidOn: '2026-09-20', method: 'transfer', kind: 'transfer', channel: null, amountSen: 10_000, reference: null, orNumber: null,
    ageDays: 3, state: 'WAITING_CONFIRMATION', bankAccountCode: null, statementUpTo: null, jeNo: null, ...over,
  });
  const line = (lineId: number, over: Partial<UnmatchedBankLine>): UnmatchedBankLine => ({
    lineId, statementId: 1, accountCode: '310-0010', bankName: 'Maybank 5123', bookedOn: '2026-09-05', month: '2026-09',
    description: 'IBG', reference: null, amountSen: 50_000, what: 'IN', kind: 'OTHER', acquirerCode: null, note: null,
    entryCount: 0, entries: [], ageDays: 20, ...over,
  });
  return {
    asked: [] as Array<{ what: string; from: string; to: string; enabled: boolean }>,
    printed: [] as Array<{ title: string; subtitle: string; head: string[]; body: string[][]; totalSen: number }>,
    PAYMENTS: [
      pay('p1', { docNo: 'SO-A', customerName: 'Chong', amountSen: 50_000, orNumber: 'CODraftOR-2609-001', ageDays: 20 }),
      pay('p2', { docNo: 'SO-B', state: 'NOT_MATCHED', amountSen: 12_000, jeNo: 'JE-3', bankAccountCode: '310-0010' }),
      pay('p3', { docNo: 'SO-C', kind: 'card', method: 'merchant', channel: 'MBB', state: 'CARD_TO_CONFIRM', amountSen: 30_000 }),
    ],
    LINES: [
      line(101, { description: 'TRANSFER FROM CHONG', note: 'One entry of this amount: SO-A · Chong, 04/09/2026 — match it on Bank recon.' }),
      line(105, { description: 'IBG TO ACME', amountSen: -20_000, what: 'OUT' }),
    ],
  };
});
vi.mock('./unmatched-payments-queries', () => ({
  useUnmatchedPayments: (from: string, to: string, enabled: boolean) => {
    asked.push({ what: 'payments', from, to, enabled });
    return { data: enabled ? { from, to, rows: PAYMENTS } : undefined, isLoading: false, isError: false };
  },
  useUnmatchedBankLines: (from: string, to: string, enabled: boolean) => {
    asked.push({ what: 'bank', from, to, enabled });
    return { data: enabled ? { from, to, rows: LINES } : undefined, isLoading: false, isError: false };
  },
}));
vi.mock('../../vendor/scm/lib/unmatched-payments-pdf', () => ({
  generateUnmatchedPdf: async (t: (typeof printed)[number]) => { printed.push(t); },
}));

import { UnmatchedPayments } from './UnmatchedPayments';

const draw = (at = '/scm/unmatched-payments') => render(<MemoryRouter initialEntries={[at]}><UnmatchedPayments /></MemoryRouter>);
afterEach(() => { asked.length = 0; printed.length = 0; });

describe('Unmatched payments', () => {
  test('opens on Payments: the two cards with their count and money, each payment saying where it is stuck', () => {
    draw();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(within(tabs[0]!).getByText('3')).toBeTruthy();
    expect(within(tabs[0]!).getByText(/RM 920.00/)).toBeTruthy();
    expect(within(tabs[1]!).getByText(/RM 300.00/)).toBeTruthy();
    const row = screen.getByText('SO-A').closest('tr')!;
    expect(within(row).getByText('Waiting for finance to confirm')).toBeTruthy();
    expect(within(row).getByText('CODraftOR-2609-001')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Official receipts' }).getAttribute('href')).toBe('/scm/official-receipts');
    expect(within(screen.getByText('SO-B').closest('tr')!).getByRole('link', { name: 'Bank recon' })).toBeTruthy();
    expect(within(screen.getByText('SO-C').closest('tr')!).getByRole('link', { name: 'Merchant recon' })).toBeTruthy();
    expect(screen.getByText('3 payments not matched, RM 920.00 in total.')).toBeTruthy();
  });

  test('a chip narrows the list to where the rows are stuck', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Card: on a merchant report, not confirmed (1)' }));
    expect(screen.getByText('SO-C')).toBeTruthy();
    expect(screen.queryByText('SO-A')).toBeNull();
    expect(screen.getByText('1 payment not matched, RM 300.00 in total.')).toBeTruthy();
  });

  test('the bank lines list, money in and out, with why each is open', () => {
    draw('/scm/unmatched-payments?list=bank');
    const row = screen.getByText('TRANSFER FROM CHONG').closest('tr')!;
    expect(within(row).getByText('Money in')).toBeTruthy();
    expect(within(row).getByText(/One entry of this amount/)).toBeTruthy();
    expect(within(screen.getByText('IBG TO ACME').closest('tr')!).getByText('(200.00)')).toBeTruthy();
    expect(screen.getByText('2 bank lines with no entry matched, RM 300.00 net.')).toBeTruthy();
  });

  test('a From after the To asks nothing and says so', () => {
    draw();
    fireEvent.change(screen.getByLabelText('Dated from'), { target: { value: '2099/01/01' } });
    fireEvent.blur(screen.getByLabelText('Dated from'));
    expect(asked.at(-1)!.enabled).toBe(false);
    expect(screen.getAllByText('The From date is after the To date.').length).toBeGreaterThan(0);
  });

  test('PDF prints what the table shows, under the dates and the chip', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Waiting for finance to confirm (1)' }));
    fireEvent.click(screen.getAllByRole('button', { name: /PDF/ })[0]!);
    await vi.waitFor(() => expect(printed).toHaveLength(1));
    expect(printed[0]).toMatchObject({ title: 'Unmatched payments', totalSen: 50_000 });
    expect(printed[0]!.subtitle).toContain('Filter: Waiting for finance to confirm');
    expect(printed[0]!.body).toHaveLength(1);
    expect(printed[0]!.head).not.toContain('');
  });
});
