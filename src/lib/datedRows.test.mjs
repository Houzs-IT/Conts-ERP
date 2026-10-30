// node --test src/lib/datedRows.test.mjs. Which dated price or contract applies on a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inForce, heldContract } from '../../functions/_lib/datedRows.ts';

const prices = [{ effective_from: '2026-12-01', owner_price: 200 }, { effective_from: '2000-01-01', owner_price: 100 }];

test('a job before the date keeps the old price, one on or after it takes the new', () => {
  assert.equal(inForce(prices, '2026-11-30').owner_price, 100);
  assert.equal(inForce(prices, '2026-12-01').owner_price, 200);
  assert.equal(inForce(prices, '2027-01-15').owner_price, 200);
});

test('no row in force falls through to the list price', () => {
  assert.equal(inForce(undefined, '2026-12-01'), null);
  assert.equal(inForce([prices[0]], '2026-11-30'), null);
});

const old = { id: 'old', starts_on: '2025-01-01' }, older = { id: 'older', starts_on: '2024-01-01' }, next = { id: 'next', starts_on: '2026-12-01' };

test('a contract starting later is held back: the newest one begun applies until then', () => {
  assert.equal(heldContract(next, [next, older, old], '2026-10-30'), old);
  assert.equal(heldContract(next, [next], '2026-10-30'), null);
});

test('from its start date the contract applies', () => {
  assert.equal(heldContract(next, [next, old], '2026-12-01'), null);
  assert.equal(heldContract(null, [old], '2026-10-30'), null);
});
