// node --test src/lib/priceRaise.test.mjs. Prices changed by a percent, worked out once in sen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayAfter, figuresChanged, hasChangeInside, percentToBasisPoints, raiseFigures, raiseSen } from '../../functions/_lib/priceRaise.ts';

test('raises and lowers to the nearest sen', () => {
  assert.equal(raiseSen(4000, 1000), 4400);
  assert.equal(raiseSen(2995, -500), 2845);
  assert.equal(raiseSen(10, 500), 11);
  assert.equal(raiseSen(3333, 250), 3416);
  assert.equal(raiseSen(5000, -10_000), 0);
});

test('reads a percent with up to two decimals, blank as no change', () => {
  assert.equal(percentToBasisPoints(10), 1000);
  assert.equal(percentToBasisPoints(-5), -500);
  assert.equal(percentToBasisPoints(2.75), 275);
  assert.equal(percentToBasisPoints(null), null);
  assert.equal(percentToBasisPoints(''), null);
});

test('rejects a percent that is not a number, too precise, or out of range', () => {
  assert.equal(percentToBasisPoints('10'), undefined);
  assert.equal(percentToBasisPoints(1.234), undefined);
  assert.equal(percentToBasisPoints(-101), undefined);
  assert.equal(percentToBasisPoints(1001), undefined);
  assert.equal(percentToBasisPoints(Number.NaN), undefined);
});

test('raises only the figures that are set, and only the ones asked for', () => {
  const raise = { ownerBasisPoints: 1000, internalBasisPoints: null };
  assert.deepEqual(raiseFigures({ owner_price: 4000, internal_cost: 2500 }, raise), { owner_price: 4400, internal_cost: 2500 });
  assert.deepEqual(raiseFigures({ owner_price: null, internal_cost: 2500 }, { ownerBasisPoints: 1000, internalBasisPoints: 1000 }), { owner_price: null, internal_cost: 2750 });
});

test('tells whether a raise changed anything', () => {
  assert.equal(figuresChanged({ owner_price: 4000, internal_cost: null }, { owner_price: 4000, internal_cost: null }), false);
  assert.equal(figuresChanged({ owner_price: 4000, internal_cost: null }, { owner_price: 4400, internal_cost: null }), true);
});

test('the day after crosses month and year ends', () => {
  assert.equal(dayAfter('2026-12-01'), '2026-12-02');
  assert.equal(dayAfter('2027-01-31'), '2027-02-01');
  assert.equal(dayAfter('2026-12-31'), '2027-01-01');
  assert.equal(dayAfter('2028-02-28'), '2028-02-29');
});

test('a change strictly inside the window is found, its edges are not', () => {
  assert.equal(hasChangeInside(['2027-01-25'], '2027-01-20', '2027-02-06'), true);
  assert.equal(hasChangeInside(['2027-01-20', '2027-02-06', '2026-11-01'], '2027-01-20', '2027-02-06'), false);
  assert.equal(hasChangeInside([], '2027-01-20', '2027-02-06'), false);
});
