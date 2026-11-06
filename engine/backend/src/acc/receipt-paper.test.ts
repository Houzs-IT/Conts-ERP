import { describe, expect, it } from 'vitest';
import { receiptPaper } from './receipts';

const client = (rows: Record<string, unknown>) => ({
  from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null }) }) }) }),
});
const payment = { paymentId: 'p', companyId: 1, companyCode: 'HOUZS', method: 'cash', amountSen: 100, paidAt: '2026-11-06' };

describe('what a receipt reads', () => {
  it('an invoice payment shows the invoice number and customer, not the invoice id', async () => {
    const sb = client({ sales_invoices: { invoice_number: 'TC-SI-2611-005', debtor_name: 'TESTING' } });
    expect(await receiptPaper(sb, { ...payment, source: 'SIPAY', docNo: 'uuid' })).toEqual({ docNo: 'TC-SI-2611-005', customerName: 'TESTING' });
  });
  it('an order payment takes the customer from the order', async () => {
    const sb = client({ mfg_sales_orders: { debtor_name: 'TESTING MR TYGER' } });
    expect(await receiptPaper(sb, { ...payment, source: 'SOPAY', docNo: 'TC-SO-2611-018' })).toEqual({ docNo: 'TC-SO-2611-018', customerName: 'TESTING MR TYGER' });
  });
  it('a failed read keeps what the caller gave, so the receipt is still born', async () => {
    const sb = { from: () => { throw new Error('down'); } };
    expect(await receiptPaper(sb, { ...payment, source: 'SOPAY', docNo: 'TC-SO-1' })).toEqual({ docNo: 'TC-SO-1', customerName: null });
  });
});
