// A save must refresh every screen that shows what it moved, and say so when part of it did not land
// (docs/SAVE-BUG-CLASSES.md, classes "stale screen after a save" and "error swallowed as success").
// authed-fetch and the notifier are mocked at the module seam; each test drives the real hook and reads which
// query keys it invalidated.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('./authed-fetch', () => ({ authedFetch: vi.fn() }));
vi.mock('./dialog-service', () => ({ serviceNotify: vi.fn() }));

import { authedFetch } from './authed-fetch';
import { serviceNotify } from './dialog-service';
import { useApprovePaymentVoucher, useCancelPaymentVoucher, usePostPaymentVoucher } from './payment-voucher-queries';
import { useAddSalesOrderPayment, useDeleteSalesOrderPayment } from './sales-order-queries';
import { useAddGrnItem, useCreateGrn } from './grn-queries';
import { useCreateDeliveryReturn } from './delivery-return-queries';
import { useSetDocumentHold } from './document-hold-queries';
import { reportInBandFailure } from './mutation-error';

const fetchMock = vi.mocked(authedFetch);
const notifyMock = vi.mocked(serviceNotify);

function setup<T>(hook: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(hook, { wrapper });
  const keys = () => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey?: unknown }).queryKey));
  return { result, keys };
}

beforeEach(() => { fetchMock.mockReset(); notifyMock.mockReset(); });

describe('payment voucher: posting refreshes the invoices it settled', () => {
  test.each([
    ['post', usePostPaymentVoucher],
    ['approve (posts the GL in the same request)', useApprovePaymentVoucher],
    ['cancel', useCancelPaymentVoucher],
  ])('%s', async (_name, hook) => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { result, keys } = setup(() => (hook as () => { mutateAsync: (id: string) => Promise<unknown> })());
    await act(() => result.current.mutateAsync('pv-1'));
    for (const k of ['purchase-invoices', 'purchase-invoice-detail', 'ap-invoices', 'ap-invoice', 'supplier-advances', 'daily-bank']) {
      expect(keys()).toContain(JSON.stringify([k]));
    }
    expect(keys()).toContain(JSON.stringify(['payment-voucher-detail', 'pv-1']));
  });
});

describe('sales order payment: the header and money panel refresh with the payments table', () => {
  test('add', async () => {
    fetchMock.mockResolvedValueOnce({ payment: {} });
    const { result, keys } = setup(() => useAddSalesOrderPayment());
    await act(() => result.current.mutateAsync({ docNo: 'TC-SO-1', amountSen: 100 }));
    expect(keys()).toContain(JSON.stringify(['mfg-sales-order-detail', 'TC-SO-1']));
    expect(keys()).toContain(JSON.stringify(['so-money', 'TC-SO-1']));
  });
  test('delete', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { result, keys } = setup(() => useDeleteSalesOrderPayment());
    await act(() => result.current.mutateAsync({ docNo: 'TC-SO-1', id: 'p1', version: 1 }));
    expect(keys()).toContain(JSON.stringify(['mfg-sales-order-detail', 'TC-SO-1']));
    expect(keys()).toContain(JSON.stringify(['so-money', 'TC-SO-1']));
  });
});

describe('goods receipt: a refused stock IN or PO recount is said, and the PO refreshes', () => {
  test('create that posted with a refused stock IN', async () => {
    fetchMock.mockResolvedValueOnce({ id: 'g1', grnNumber: 'GRN-1', movementErrors: ['IN X: refused'] });
    const { result, keys } = setup(() => useCreateGrn());
    await act(() => result.current.mutateAsync({ supplierId: 's1' }));
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'GRN saved, but the stock was not received' }));
    expect(keys()).toContain(JSON.stringify(['mfg-purchase-order-detail']));
  });
  test('a line added to a posted receipt with a refused stock IN', async () => {
    fetchMock.mockResolvedValueOnce({ item: {}, movementErrors: ['IN X: refused'] });
    const { result } = setup(() => useAddGrnItem());
    await act(() => result.current.mutateAsync({ grnId: 'g1', itemCode: 'X' }));
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Line added, but the stock was not received' }));
  });
  test('a clean create says nothing', async () => {
    fetchMock.mockResolvedValueOnce({ id: 'g1', grnNumber: 'GRN-1' });
    const { result } = setup(() => useCreateGrn());
    await act(() => result.current.mutateAsync({ supplierId: 's1' }));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('delivery return: a refused stock IN is said', () => {
  test('create', async () => {
    fetchMock.mockResolvedValueOnce({ id: 'd1', returnNumber: 'DR-1', movementErrors: ['IN DR-1: refused'] });
    const { result } = setup(() => useCreateDeliveryReturn());
    await act(() => result.current.mutateAsync({}));
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delivery return saved, but the stock was not received back' }));
  });
});

describe('hold marker on a purchase order refreshes the keys the PO screens read', () => {
  test('po', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { result, keys } = setup(() => useSetDocumentHold('po'));
    await act(() => result.current.mutateAsync({ key: 'po-1', onHold: true }));
    expect(keys()).toContain(JSON.stringify(['mfg-purchase-orders']));
    expect(keys()).toContain(JSON.stringify(['mfg-purchase-order-detail']));
  });
});

describe('reportInBandFailure reads the PO recount failure', () => {
  test('recountError alone is reported', () => {
    reportInBandFailure('GRN posted', { recountError: 'po read failed' });
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved, but the purchase order received qty was not updated' }));
  });
});
