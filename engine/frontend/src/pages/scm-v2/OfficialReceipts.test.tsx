/* OfficialReceipts — the OR book (GL redesign 9b): drafts print with the
   watermark, formal rows only print. Confirm received (SOP 4.2, 29 Oct 2026)
   is finance's alone (scm.payment_voucher.post): it asks which bank the money
   landed in, the default bank first, and says what it issued and posted. Since
   2026-09-16 (owner: or 我如何查看 amount 是对的) the page opens on this month:
   the list carries the month and sums under it, and the month's CHECK reads
   the customer payments against the receipts and names every row behind a
   difference. The server half is backend/tests/officialReceipts.test.ts and
   backend/tests/receiptsCheck.test.ts. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';

const { fetchMock, pdfMock, check, perms, chooseMock, notifyMock } = vi.hoisted(() => {
  const rows = [
    {
      id: 5, or_number: 'HCDraftOR-2609-002', status: 'DRAFT', payment_source: 'SOPAY', payment_id: 'p2',
      doc_no: 'HC-SO-013400', customer_name: 'TAN MEI LING', method: 'transfer', amount_sen: 150000,
      paid_at: '2026-09-04', channel_account_code: null, issued_at: null, issued_by: null, created_at: '2026-09-04',
    },
    {
      id: 4, or_number: 'HCCOR-2609-001', status: 'FORMAL', payment_source: 'SOPAY', payment_id: 'p1',
      doc_no: 'HC-SO-013399', customer_name: 'AHMAD BIN ALI', method: 'cash', amount_sen: 50000,
      paid_at: '2026-09-03', channel_account_code: '300-0000', issued_at: '2026-09-03', issued_by: 'Chew', created_at: '2026-09-03',
    },
  ];
  /* A dirty month: three payments came in, two have receipts. */
  const check = {
    current: {
      month: '2026-09',
      payments: { count: 3, totalSen: 250000 },
      receipts: { count: 2, totalSen: 200000 },
      diffSen: 50000,
      missing: [{ source: 'SOPAY', paymentId: 'p9', docNo: 'HC-SO-013401', paidAt: '2026-09-07', method: 'transfer', amountSen: 50000 }],
      mismatched: [],
      orphans: [],
    } as Record<string, unknown>,
  };
  return {
    fetchMock: vi.fn(async (path: string, _init?: RequestInit) => {
      if (path.startsWith('/accounting/receipts/check')) return check.current;
      if (path === '/accounting/receipts/banks') {
        return { defaultCode: '310-0010', banks: [{ code: '310-0005', name: 'AMBANK' }, { code: '310-0010', name: 'HONG LEONG' }, { code: '310-0020', name: 'MAYBANK' }] };
      }
      if (path.startsWith('/accounting/receipts/')) return { ok: true, orNumber: 'HCMOR-2609-001', already: false, posting: { status: 'posted', jeNo: 'HC-JV-2609-014' } };
      return { receipts: rows };
    }),
    pdfMock: vi.fn(async (_r: unknown, _o: unknown) => {}),
    check,
    perms: { finance: true },
    chooseMock: vi.fn(async (_o: { title: string; options: Array<{ value: string; label: string }> }) => '310-0020' as string | null),
    notifyMock: vi.fn(async (_o: { title: string; body?: unknown }) => {}),
  };
});
vi.mock('../../vendor/scm/lib/authed-fetch', () => ({
  authedFetch: (path: string, init?: RequestInit) => fetchMock(path, init),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => p === 'scm.payment_voucher.post' && perms.finance }) }));
vi.mock('../../vendor/scm/components/ChoiceDialog', () => ({ useChoice: () => chooseMock }));
vi.mock('../../vendor/scm/components/NotifyDialog', () => ({ useNotify: () => notifyMock }));
vi.mock('../../vendor/scm/lib/receipt-pdf', () => ({ generateReceiptPdf: pdfMock }));

import { OfficialReceipts, monthWord, mytMonth } from './OfficialReceipts';

const draw = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter><QueryClientProvider client={qc}><OfficialReceipts /></QueryClientProvider></MemoryRouter>,
  );
};
const listPaths = () => fetchMock.mock.calls.map(([p]) => p).filter((p) => p.startsWith('/accounting/receipts') && !p.startsWith('/accounting/receipts/'));

describe('the OR book', () => {
  test('a draft offers Print + Confirm received to finance; a formal row only prints', async () => {
    perms.finance = true;
    draw();
    await waitFor(() => expect(screen.getByText('HCDraftOR-2609-002')).toBeTruthy());
    expect(screen.getByText('HCCOR-2609-001')).toBeTruthy();
    /* One Confirm received (the draft), two Prints (both rows). */
    expect(screen.getAllByText('Confirm received')).toHaveLength(1);
    expect(screen.getAllByText('Print')).toHaveLength(2);
  });

  test('anyone without the finance key sees no Confirm received', async () => {
    perms.finance = false;
    draw();
    await waitFor(() => expect(screen.getByText('HCDraftOR-2609-002')).toBeTruthy());
    expect(screen.queryByText('Confirm received')).toBeNull();
    perms.finance = true;
  });

  test('Waiting for confirmation lists the drafts', async () => {
    fetchMock.mockClear();
    draw();
    await waitFor(() => expect(screen.getByText('HCDraftOR-2609-002')).toBeTruthy());
    fireEvent.click(screen.getByText('Waiting for confirmation'));
    await waitFor(() => expect(listPaths()).toContain(`/accounting/receipts?status=DRAFT&month=${mytMonth()}`));
  });

  test('Print hands the ROW to the pdf (draft prints the watermark side)', async () => {
    pdfMock.mockClear();
    draw();
    await waitFor(() => expect(screen.getByText('HCDraftOR-2609-002')).toBeTruthy());
    fireEvent.click(screen.getAllByText('Print')[0]!);
    await waitFor(() => expect(pdfMock).toHaveBeenCalledTimes(1));
    const [r, opts] = pdfMock.mock.calls[0]!;
    expect((r as { or_number: string }).or_number).toBe('HCDraftOR-2609-002');
    expect(opts).toEqual({ action: 'print' });
  });

  test('Confirm received asks which bank (the default first), POSTs it for THAT receipt and says what was issued and posted', async () => {
    fetchMock.mockClear();
    chooseMock.mockClear();
    notifyMock.mockClear();
    draw();
    await waitFor(() => expect(screen.getByText('Confirm received')).toBeTruthy());
    fireEvent.click(screen.getByText('Confirm received'));
    await waitFor(() => expect(chooseMock).toHaveBeenCalledTimes(1));
    const asked = chooseMock.mock.calls[0]![0];
    expect(asked.options.map((o) => o.value)).toEqual(['310-0010', '310-0005', '310-0020']);
    expect(asked.options[0]!.label).toContain('default');
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([p]) => p === '/accounting/receipts/5/formalise');
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ accountCode: '310-0020' });
    });
    await waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(1));
    const said = notifyMock.mock.calls[0]![0];
    expect(said.title).toBe('Payment confirmed');
    expect(String(said.body)).toContain('HCMOR-2609-001');
    expect(String(said.body)).toContain('HC-JV-2609-014');
  });

  /* Payment before its invoice (renovation, spec 7.6): more confirmed than invoiced offers the next instalment. */
  test('a confirm that offers the next instalment bills it at the offered amount on "now", and nothing on "Later"', async () => {
    const offer = { soDocNo: 'HC-SO-2611-009', instalmentId: 'inst-2', seq: 2, label: 'Carpentry', amountSen: 400000, receivedSen: 400000, billedSen: 300000 };
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/formalise')) return { ok: true, orNumber: 'HCMOR-2609-001', already: false, posting: { status: 'posted', jeNo: 'HC-JV-2609-014' }, billNext: offer };
      if (path.includes('/instalments/')) return { kind: 'INVOICE', invoiceNumber: 'HC-SI-2611-002', amountSen: 400000, posting: { status: 'posted' } };
      return base(path, init);
    });
    try {
      for (const pick of ['later', 'now'] as const) {
        fetchMock.mockClear();
        chooseMock.mockReset();
        chooseMock.mockImplementationOnce(async () => '310-0020').mockImplementationOnce(async () => pick);
        notifyMock.mockClear();
        const view = draw();
        await waitFor(() => expect(screen.getByText('Confirm received')).toBeTruthy());
        fireEvent.click(screen.getByText('Confirm received'));
        await waitFor(() => expect(chooseMock).toHaveBeenCalledTimes(2));
        const asked = chooseMock.mock.calls[1]![0];
        expect(asked.options.map((o) => o.label)).toEqual(['Bill the next instalment now', 'Later']);
        const bill = () => fetchMock.mock.calls.find(([p]) => String(p).includes('/instalments/'));
        if (pick === 'now') {
          await waitFor(() => expect(bill()).toBeTruthy());
          expect(bill()![0]).toBe('/renovation/sales-orders/HC-SO-2611-009/instalments/inst-2/bill');
          expect(JSON.parse(String(bill()![1]!.body))).toMatchObject({ expectedAmountSen: 400000 });
          await waitFor(() => expect(notifyMock).toHaveBeenCalled());
          expect(String(notifyMock.mock.calls.at(-1)![0].body)).toContain('HC-SI-2611-002');
        } else {
          /* The choice itself said the payment is confirmed: Later bills nothing and says nothing more. */
          await new Promise((r) => setTimeout(r, 20));
          expect(bill()).toBeUndefined();
          expect(notifyMock).not.toHaveBeenCalled();
        }
        view.unmount();
      }
    } finally {
      fetchMock.mockImplementation(base);
      chooseMock.mockReset();
      chooseMock.mockImplementation(async () => '310-0020');
    }
  });

  test('cancelling the bank choice confirms nothing', async () => {
    fetchMock.mockClear();
    chooseMock.mockImplementationOnce(async () => null);
    draw();
    await waitFor(() => expect(screen.getByText('Confirm received')).toBeTruthy());
    fireEvent.click(screen.getByText('Confirm received'));
    await waitFor(() => expect(chooseMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([p]) => String(p).endsWith('/formalise'))).toBe(false);
  });

  test('opens on this month: the list carries it and sums under the rows; the check names the totals, the difference and the payment without a receipt', async () => {
    fetchMock.mockClear();
    draw();
    await waitFor(() => expect(screen.getByText('HCDraftOR-2609-002')).toBeTruthy());
    expect(listPaths()).toContain(`/accounting/receipts?month=${mytMonth()}`);
    expect(fetchMock.mock.calls.some(([p]) => p === `/accounting/receipts/check?month=${mytMonth()}`)).toBe(true);
    expect((screen.getByLabelText('Receipts month') as HTMLInputElement).value).toBe(mytMonth());
    const total = screen.getByTestId('receipts-total');
    expect(total.textContent).toContain(`2 receipts in ${monthWord(mytMonth())}`);
    expect(total.textContent).toContain('RM 2,000.00');
    const card = await screen.findByLabelText('Receipts check');
    await waitFor(() => expect(card.textContent).toContain('Customer payments RM 2,500.00 (3)'));
    expect(card.textContent).toContain('Receipts RM 2,000.00 (2)');
    expect(card.textContent).toContain('Difference RM 500.00');
    expect(card.textContent).toContain('Payments without a receipt (1)');
    expect(card.textContent).toContain('HC-SO-013401');
    expect(card.textContent).not.toContain('Every payment of the month has its receipt');
  });

  test('a clean month says so; Any month drops the check and reads the newest', async () => {
    check.current = { month: '2026-09', payments: { count: 2, totalSen: 200000 }, receipts: { count: 2, totalSen: 200000 }, diffSen: 0, missing: [], mismatched: [], orphans: [] };
    fetchMock.mockClear();
    draw();
    const card = await screen.findByLabelText('Receipts check');
    await waitFor(() => expect(card.textContent).toContain('Every payment of the month has its receipt, for its own amount.'));
    expect(card.textContent).toContain('Difference RM 0.00');
    fireEvent.click(screen.getByText('Any month'));
    await waitFor(() => expect(listPaths()).toContain('/accounting/receipts'));
    expect(screen.queryByLabelText('Receipts check')).toBeNull();
    expect(screen.getByText('This month')).toBeTruthy();
  });

  test('monthWord', () => {
    expect(monthWord('2026-06')).toBe('06/2026');
    expect(monthWord('')).toBe('');
  });
});
