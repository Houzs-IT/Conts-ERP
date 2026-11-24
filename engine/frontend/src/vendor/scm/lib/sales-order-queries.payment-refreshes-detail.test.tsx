// TC-SO-2611-028 (21 Nov 2026): the SO PDF listed RM 500 and RM 7,757 under PAYMENTS RECEIVED but printed
// "Paid to date RM 500.00". The payments ledger refetched after the RM 7,757 was booked; the order's detail
// (['mfg-sales-order-detail', docNo], which carries paid_sen_total) is not under the ['mfg-sales-orders'] prefix
// and kept the old figure. Every payment write now marks that detail stale too.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('./authed-fetch', () => ({
  authedFetch: vi.fn(() => Promise.resolve({ payment: { id: 'p1' }, ok: true })),
  API_URL: 'http://test.local/api/scm',
  humanApiError: (e: unknown) => String(e),
}));
vi.mock('./mutation-error', () => ({ writeFailed: () => {}, writeFailedAs: () => () => {} }));

import {
  useAddSalesOrderPayment, useAttachSalesOrderPaymentSlip, useDeleteSalesOrderPayment, useEditSalesOrderPayment,
} from './sales-order-queries';
import { soPdfPaidSen } from './sales-order-pdf';

const DETAIL = ['mfg-sales-order-detail', 'SO-1'];
const OTHER = ['mfg-sales-order-detail', 'SO-2'];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(DETAIL, { salesOrder: { doc_no: 'SO-1', paid_sen_total: 50000 }, items: [] });
  qc.setQueryData(OTHER, { salesOrder: { doc_no: 'SO-2' }, items: [] });
  return { qc };
}

describe('a payment write refreshes the order detail that carries paid_sen_total', () => {
  async function expectDetailRefreshed(run: (wrapper: ({ children }: { children: ReactNode }) => ReactNode) => Promise<void>, qc: QueryClient) {
    expect(qc.getQueryState(DETAIL)?.isInvalidated).toBe(false);
    await run(({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>);
    expect(qc.getQueryState(DETAIL)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(OTHER)?.isInvalidated).toBe(false);
  }
  test('add', async () => {
    const { qc } = setup();
    await expectDetailRefreshed(async (wrapper) => {
      const { result } = renderHook(() => useAddSalesOrderPayment(), { wrapper });
      await act(async () => { await result.current.mutateAsync({ docNo: 'SO-1', amountSen: 775700 }); });
    }, qc);
  });
  test('edit', async () => {
    const { qc } = setup();
    await expectDetailRefreshed(async (wrapper) => {
      const { result } = renderHook(() => useEditSalesOrderPayment(), { wrapper });
      await act(async () => { await result.current.mutateAsync({ docNo: 'SO-1', id: 'p1', version: 1, amountSen: 775700 }); });
    }, qc);
  });
  test('delete', async () => {
    const { qc } = setup();
    await expectDetailRefreshed(async (wrapper) => {
      const { result } = renderHook(() => useDeleteSalesOrderPayment(), { wrapper });
      await act(async () => { await result.current.mutateAsync({ docNo: 'SO-1', id: 'p1', version: 1 }); });
    }, qc);
  });
  test('attach slip', async () => {
    const { qc } = setup();
    await expectDetailRefreshed(async (wrapper) => {
      const { result } = renderHook(() => useAttachSalesOrderPaymentSlip(), { wrapper });
      await act(async () => { await result.current.mutateAsync({ docNo: 'SO-1', id: 'p1', uploadSessionId: 'u1' }); });
    }, qc);
  });
});

describe('soPdfPaidSen: Paid to date agrees with the payments printed', () => {
  const rows = [{ amount_sen: 50000 }, { amount_sen: 775700 }];
  test('a stale header total does not win over the rows the print lists', () => {
    expect(soPdfPaidSen({ paid_sen_total: 50000, paid_outside_ledger_sen: 0 }, rows)).toBe(825700);
  });
  test('a legacy header deposit outside the ledger is still counted', () => {
    expect(soPdfPaidSen({ paid_sen_total: 925700, paid_outside_ledger_sen: 100000 }, rows)).toBe(925700);
  });
  test('without the split (older server, consignment) the header total stands, then the rows', () => {
    expect(soPdfPaidSen({ paid_sen_total: 12300 }, rows)).toBe(12300);
    expect(soPdfPaidSen({}, rows)).toBe(825700);
  });
});
