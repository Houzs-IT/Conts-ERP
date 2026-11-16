// A request paid through an AP invoice (chew, 15 Nov 2026): the balance of a paid deposit is asked for from the deposit
// request, once at a time, for what the bill still owes; the request shows its bill and what was first asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { canAskBalance, balanceSen, billLabel, onBill, updatedFromBill } = await import('./requestApInvoice.ts');

const bill = { invoiceNumber: 'HCAPI-2611-004', provisional: true, totalSen: 10_000, paidSen: 3_000 };

test('the balance is asked on a paid deposit whose bill still owes, once at a time', () => {
  assert.equal(canAskBalance({ type: 'DEPOSIT', status: 'PAID', apInvoice: bill }), true);
  assert.equal(balanceSen({ type: 'DEPOSIT', status: 'PAID', apInvoice: bill }), 7_000);
  /* The 3,000 deposit paid as an advance, not knocked off against the bill yet: still not asked for again. */
  assert.equal(balanceSen({ type: 'DEPOSIT', status: 'PAID', amountSen: 3_000, apInvoice: { ...bill, paidSen: 0 } }), 7_000);
  assert.equal(canAskBalance({ type: 'DEPOSIT', status: 'SUBMITTED', apInvoice: bill }), false);
  assert.equal(canAskBalance({ type: 'DEPOSIT', status: 'PAID', apInvoice: null }), false);
  assert.equal(canAskBalance({ type: 'PAYMENT', status: 'PAID', apInvoice: bill }), false);
  assert.equal(canAskBalance({ type: 'DEPOSIT', status: 'PAID', apInvoice: { ...bill, paidSen: 10_000 } }), false);
  assert.equal(canAskBalance({ type: 'DEPOSIT', status: 'PAID', apInvoice: bill, balanceRequests: [{ status: 'SUBMITTED' }] }), false);
  assert.equal(canAskBalance({ type: 'DEPOSIT', status: 'PAID', apInvoice: bill, balanceRequests: [{ status: 'WITHDRAWN' }] }), true);
});

test('the request shows its bill, and that the bill changed it', () => {
  assert.equal(billLabel({ type: 'DEPOSIT', status: 'PAID', apInvoice: bill }), 'HCAPI-2611-004 (quotation)');
  assert.equal(billLabel({ type: 'PAYMENT', status: 'SUBMITTED', apInvoice: { ...bill, provisional: false } }), 'HCAPI-2611-004');
  assert.equal(billLabel({ type: 'PAYMENT', status: 'SUBMITTED' }), null);
  assert.equal(onBill({ type: 'PAYMENT', status: 'SUBMITTED', apInvoice: bill }), true);
  assert.equal(updatedFromBill({ amountSen: 6_800, askedAmountSen: 10_000, askedLines: [{ amountSen: 10_000 }] }), true);
  assert.equal(updatedFromBill({ amountSen: 10_000, askedLines: null }), false);
});
