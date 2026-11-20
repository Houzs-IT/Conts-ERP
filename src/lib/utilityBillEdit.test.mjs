// A utility bill's amount is changed from Utility bills until its voucher is processed, record-only bills included
// (chew, 20 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { billEdit, billEditProblem, partNow, shareNow } = await import('./utilityBillEdit.ts');

test('a shared bill keeps its owner part when only the whole changes', () => {
  const now = { whole: 7020, amount: 67, recordOnly: false };
  assert.equal(partNow(now), 6953);
  assert.deepEqual(billEdit(now, 8000), { whole: 8000, ownerPart: 6953, share: 1047, recordOnly: false });
});

test('a record-only bill is the owner whole bill and stays so when only the whole changes', () => {
  const now = { whole: 31424, amount: 31424, recordOnly: true };
  assert.equal(partNow(now), 31424);
  assert.equal(shareNow(now), 0);
  assert.deepEqual(billEdit(now, 30000), { whole: 30000, ownerPart: 30000, share: 0, recordOnly: true });
});

test('a record-only bill with a smaller owner part goes back on the shared costs', () => {
  const now = { whole: 31424, amount: 31424, recordOnly: true };
  assert.deepEqual(billEdit(now, 31424, 0), { whole: 31424, ownerPart: 0, share: 31424, recordOnly: false });
  assert.deepEqual(billEdit(now, 31424, 1000), { whole: 31424, ownerPart: 1000, share: 30424, recordOnly: false });
});

test('an owner part equal to the whole makes a shared bill record only', () => {
  const e = billEdit({ whole: 5000, amount: 5000, recordOnly: false }, 5000, 5000);
  assert.equal(e.recordOnly, true);
  assert.equal(billEditProblem(e), null);
});

test('an owner part above the whole, or a whole of nothing, is refused', () => {
  assert.match(billEditProblem(billEdit({ whole: 5000, amount: 5000, recordOnly: false }, 5000, 6000)), /more than the whole/);
  assert.match(billEditProblem(billEdit({ whole: 5000, amount: 5000, recordOnly: false }, 0)), /whole bill/);
});
