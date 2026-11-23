// D23 (save-integrity, 22 Nov 2026): the money creates that had no Idempotency-Key now send one, and a form that
// opens inside a list page gets a fresh key set each time it opens.
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn(async (..._args: unknown[]) => ({ ok: true })) }));
vi.mock('./authed-fetch', () => ({ authedFetch: (...args: unknown[]) => fetchMock(...args) }));

import { useCreateDebtorBill, useCreateDebtorReceipt, useCreateReceipt } from './accounting-queries';
import { useCreateApInvoice } from './ap-invoice-queries';
import { useCreateCreditNote } from './credit-note-queries';
import { useContentBoundIdempotencyKeyFor } from '../../../lib/idempotency';

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const lastCall = () => fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];

describe('money creates carry the Idempotency-Key', () => {
  const cases: Array<[string, () => { mutateAsync: (v: never) => Promise<unknown> }, Record<string, unknown>]> = [
    ['general receipt', useCreateReceipt, { payerName: 'A', bankAccountCode: '310-0010', lines: [] }],
    ['debtor bill', useCreateDebtorBill, { debtorId: 'd-1', lines: [] }],
    ['debtor receipt', useCreateDebtorReceipt, { debtorId: 'd-1', bankAccountCode: '310-0010', allocations: [] }],
    ['AP invoice', useCreateApInvoice, { supplierId: 's-1', invoiceDate: '2026-11-22', lines: [] }],
    ['credit note', useCreateCreditNote, { kind: 'CN', noteDate: '2026-11-22', lines: [] }],
  ];
  for (const [name, hook, body] of cases) {
    it(`${name}: the key goes in the header, not the body`, async () => {
      const { result } = renderHook(() => hook(), { wrapper: wrap });
      const send = result.current.mutateAsync as unknown as (v: Record<string, unknown>) => Promise<unknown>;
      await act(async () => { await send({ ...body, idempotencyKey: 'k-123' }); });
      const [, init] = lastCall();
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k-123');
      expect(JSON.parse(String(init.body))).not.toHaveProperty('idempotencyKey');
    });
  }
});

describe('useContentBoundIdempotencyKeyFor', () => {
  it('keeps the key while the same form is open and mints a new one when the form opens again', () => {
    let intent: unknown = { open: 1 };
    const { result, rerender } = renderHook(() => useContentBoundIdempotencyKeyFor(intent));
    const first = result.current.keyFor({ total: 100 }).key;
    rerender();
    expect(result.current.keyFor({ total: 100 }).key).toBe(first);
    intent = { open: 2 };
    rerender();
    expect(result.current.keyFor({ total: 100 }).key).not.toBe(first);
  });
});
