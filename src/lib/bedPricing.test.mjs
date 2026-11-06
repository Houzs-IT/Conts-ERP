// node --test src/lib/bedPricing.test.mjs. A clean priced by the unit's beds: bed size price x quantity, summed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBeds, priceFromBeds } from '../../functions/_lib/bedPricing.ts';

const prices = {
  queen: { owner_price: 4000, internal_cost: 2500, effective_from: '2026-12-01' },
  single: { owner_price: 3000, internal_cost: 2000, effective_from: '2026-12-05' },
  king: { owner_price: 5000, internal_cost: null, effective_from: '2026-12-01' },
};
const priceOf = size => prices[size] ?? null;

test('sums each bed size price times its quantity', () => {
  const total = priceFromBeds([{ size: 'queen', quantity: 2 }, { size: 'single', quantity: 1 }], priceOf);
  assert.deepEqual(total, { owner_price: 11000, internal_cost: 7000, effective_from: '2026-12-05' });
});

test('a bed size with no price leaves that figure not set', () => {
  const missingSize = priceFromBeds([{ size: 'queen', quantity: 1 }, { size: 'sofa_bed', quantity: 1 }], priceOf);
  assert.equal(missingSize.owner_price, null);
  assert.equal(missingSize.internal_cost, null);
  const missingCost = priceFromBeds([{ size: 'king', quantity: 1 }], priceOf);
  assert.equal(missingCost.owner_price, 5000);
  assert.equal(missingCost.internal_cost, null);
});

test('no beds, or no bed size priced, gives no bed price', () => {
  assert.equal(priceFromBeds([], priceOf), null);
  assert.equal(priceFromBeds([{ size: 'sofa_bed', quantity: 1 }], priceOf), null);
});

test('reads the stored beds list, as text or parsed, and drops bad rows', () => {
  assert.deepEqual(parseBeds('[{"size":"queen","quantity":2}]'), [{ size: 'queen', quantity: 2 }]);
  assert.deepEqual(parseBeds([{ size: 'king', quantity: 1 }, { size: '', quantity: 1 }, { size: 'single', quantity: 0 }]), [{ size: 'king', quantity: 1 }]);
  assert.deepEqual(parseBeds(null), []);
});
