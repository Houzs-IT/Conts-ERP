// node --test src/lib/menuPathFor.test.mjs. The sidebar a finance screen opens under (src/lib/scmEngine.ts menuPathFor):
// a record opened from a page stays under that page's side (chew, 19 Nov 2026: a purchase invoice opened from Finance →
// AP invoices must not move the sidebar to Dream Crafter).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { menuPathFor } = await import('./scmEngine.ts');

test('a purchase invoice opened from Finance → AP invoices stays under AP invoices', () => {
  assert.equal(menuPathFor('/scm/purchase-invoices/abc', '/finance/ap-invoices'), '/finance/ap-invoices');
});

test('from Procurement it is under Purchase invoices, as before', () => {
  assert.equal(menuPathFor('/scm/purchase-invoices/abc', '/procurement/purchase-invoices'), '/procurement/purchase-invoices');
});

test('a screen both sides hold keeps the side open now', () => {
  assert.equal(menuPathFor('/scm/payment-vouchers/x', '/finance/ap-invoices'), '/finance/payment-vouchers');
  assert.equal(menuPathFor('/scm/payment-vouchers/x', '/supply/finance/ap-invoices'), '/supply/finance/payment-vouchers');
});
