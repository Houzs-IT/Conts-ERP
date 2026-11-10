// node --test src/lib/hoursFlag.test.mjs. The Working Hours "short" flag judges the punch, not the box (Hookka #434).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursFlag } from './hoursFlag.ts';

const full = { clockOutAt: '2026-11-02T10:00:00Z', forgotOut: false, hours: 8 };

test('a copied or saved value under the day is not short when the punch shows a full day', () => {
  assert.equal(hoursFlag(7.5, 8, full), null);
});

test('a department split that sums under the day is not short when the punch is full', () => {
  assert.equal(hoursFlag(0.66 + 6.9, 8, full), null);
});

test('a short punch is short whatever the box says', () => {
  assert.equal(hoursFlag(8, 8, { ...full, hours: 6 }), 'short');
});

test('no punch, an open punch or a forgotten clock-out: the entered total is judged', () => {
  assert.equal(hoursFlag(6, 8, undefined), 'short');
  assert.equal(hoursFlag(6, 8, { ...full, clockOutAt: null }), 'short');
  assert.equal(hoursFlag(6, 8, { ...full, forgotOut: true }), 'short');
  assert.equal(hoursFlag(8, 8, undefined), null);
  assert.equal(hoursFlag(0, 8, undefined), null);
});

test('overtime follows the entered total', () => {
  assert.equal(hoursFlag(10, 8, full), 'OT');
});
