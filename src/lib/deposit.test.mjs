// A Direct pay deposit as a share of the bill or quotation (chew, 17 Nov 2026): the total times the percent, to the sen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { depositSen } = await import('./deposit.ts');

test('the share of the total, rounded to the sen', () => {
  assert.equal(depositSen(1_000_000, '50'), 500_000);
  assert.equal(depositSen(1_234_567, '30'), 370_370);
  assert.equal(depositSen(99_999, '33.3'), 33_300);
});

test('nothing while the total or the percent is missing or out of range', () => {
  assert.equal(depositSen(null, '50'), null);
  assert.equal(depositSen(1_000_000, ''), null);
  assert.equal(depositSen(1_000_000, '0'), null);
  assert.equal(depositSen(1_000_000, '120'), null);
  assert.equal(depositSen(1_000_000, 'abc'), null);
});
