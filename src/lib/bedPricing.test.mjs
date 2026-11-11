// node --test src/lib/bedPricing.test.mjs. A clean priced by the unit's beds: bed size price x quantity, summed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedCountKey, bedCountRows, countedBeds, isBedGridKey, parseBeds, priceByBeds, priceFromBeds } from '../../functions/_lib/bedPricing.ts';

const prices = {
  queen: { owner_price: 4000, internal_cost: 2500, effective_from: '2026-12-01' },
  single: { owner_price: 3000, internal_cost: 2000, effective_from: '2026-12-05' },
  king: { owner_price: 5000, internal_cost: null, effective_from: '2026-12-01' },
};
const priceOf = size => prices[size] ?? null;

test('sums each bed size price times its quantity', () => {
  const total = priceFromBeds([{ size: 'queen', quantity: 2 }, { size: 'single', quantity: 1 }], priceOf);
  assert.deepEqual(total, { owner_price: 11000, internal_cost: 7000, guest_price: null, effective_from: '2026-12-05' });
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

// Priced by NUMBER of beds (chew, 10 Nov 2026: YJ's pay by beds, counted as the owners' charges always were).
const yj = {
  'beds:1': { owner_price: null, internal_cost: 6000, effective_from: '2026-11-01' },
  'beds:2': { owner_price: null, internal_cost: 7000, effective_from: '2026-11-01' },
  'beds:3': { owner_price: null, internal_cost: 8500, effective_from: '2026-11-01' },
  'beds:6': { owner_price: null, internal_cost: 16000, effective_from: '2026-11-01' },
  no_beds: { owner_price: null, internal_cost: 5000, effective_from: '2026-11-01' },
};
const rowOf = key => yj[key] ?? null;

test('a floor mattress or a sofa bed is not a bed when beds are counted', () => {
  // Trion KL A29-02: 2 queens, 1 sofa bed, 2 floor mattresses is a 2-bed unit, as its owner is charged.
  assert.equal(countedBeds([{ size: 'queen', quantity: 2 }, { size: 'sofa_bed', quantity: 1 }, { size: 'single_floor_mattress', quantity: 2 }]), 2);
  assert.equal(countedBeds([{ size: 'king', quantity: 1 }, { size: 'queen', quantity: 2 }, { size: 'single', quantity: 1 }]), 4);
  assert.equal(countedBeds([]), 0);
});

test('by number of beds: the row for the count, six or more on the last row, none on the no-beds row', () => {
  assert.equal(priceByBeds('count', [{ size: 'queen', quantity: 2 }, { size: 'single_floor_mattress', quantity: 2 }], rowOf).internal_cost, 7000);
  assert.equal(priceByBeds('count', [{ size: 'queen', quantity: 3 }], rowOf).internal_cost, 8500);
  assert.equal(priceByBeds('count', [{ size: 'single', quantity: 7 }], rowOf).internal_cost, 16000);
  assert.equal(priceByBeds('count', [], rowOf).internal_cost, 5000);
  assert.equal(priceByBeds('count', [{ size: 'sofa_bed', quantity: 1 }], rowOf).internal_cost, 5000);
  // A count with no row of its own is not priced: never a guess from the next row.
  assert.equal(priceByBeds('count', [{ size: 'queen', quantity: 4 }], rowOf), null);
  // The owner price stays empty, so the owner is still charged the unit's own cleaning price.
  assert.equal(priceByBeds('count', [{ size: 'queen', quantity: 1 }], rowOf).owner_price, null);
});

test('by bed size is unchanged: each size times its quantity, no beds on the no-beds row', () => {
  const bySize = key => ({ 'bed:queen': prices.queen, 'bed:single': prices.single, no_beds: yj.no_beds })[key] ?? null;
  assert.deepEqual(priceByBeds('size', [{ size: 'queen', quantity: 2 }, { size: 'single', quantity: 1 }], bySize), { owner_price: 11000, internal_cost: 7000, guest_price: null, effective_from: '2026-12-05' });
  assert.equal(priceByBeds('size', [], bySize).internal_cost, 5000);
});

test('the grid rows by number of beds, and which stored rows belong to each way of pricing', () => {
  assert.deepEqual(bedCountRows().keys, ['beds:1', 'beds:2', 'beds:3', 'beds:4', 'beds:5', 'beds:6', 'no_beds']);
  assert.deepEqual([bedCountRows().labels['beds:1'], bedCountRows().labels['beds:2'], bedCountRows().labels['beds:6'], bedCountRows().labels.no_beds],
    ['1 bed', '2 beds', '6 or more beds', 'No beds recorded']);
  assert.equal(bedCountKey(0), 'beds:1');
  assert.equal(bedCountKey(9), 'beds:6');
  assert.equal(isBedGridKey('beds:2', 'count'), true);
  assert.equal(isBedGridKey('bed:queen', 'count'), false);
  assert.equal(isBedGridKey('bed:queen'), true);
  assert.equal(isBedGridKey('beds:2'), false);
  assert.equal(isBedGridKey('no_beds', 'count'), true);
});
