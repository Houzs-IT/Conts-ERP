/* The Payment listing on paper (ported from Houzs): the cells as drawn and the RM total, without a PDF. */
import { describe, expect, test } from 'vitest';
import { PAYMENT_LISTING_HEAD, paymentListingTable, type PaymentListingLine } from './payment-listing-pdf';

const line = (over: Partial<PaymentListingLine>): PaymentListingLine => ({
  pvNumber: 'COB-2611-001', voucherDate: '2026-11-03', payee: 'TNB', description: 'Electricity', department: 'Rental',
  bank: 'Maybank', accountNo: '5123', accountName: 'TNB BHD', ringgitSen: 32_050, currency: 'MYR', totalSen: 32_050, stage: 'Checked', ...over,
});

describe('paymentListingTable', () => {
  test('a row per voucher, the ringgit totalled; another currency prints its own amount under the ringgit', () => {
    const t = paymentListingTable([line({}), line({ pvNumber: 'COB-2611-002', ringgitSen: 65_000, currency: 'RMB', totalSen: 100_000 })]);
    expect(t.head).toBe(PAYMENT_LISTING_HEAD);
    expect(t.body[0]).toEqual(['COB-2611-001', '03/11/2026', 'TNB', 'Electricity', 'Rental', 'Maybank', '5123', 'TNB BHD', '320.50', 'Checked']);
    expect(t.body[1]![8]).toMatch(/^650\.00\nRMB/);
    expect(t.totalSen).toBe(97_050);
  });
});
