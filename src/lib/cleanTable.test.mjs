// node --test src/lib/cleanTable.test.mjs. The cleaning price table by number of beds (chew, 10 Nov 2026): Basic and Deep
// clean side by side, each with the owner's charge, the guest's charge and the cleaner's pay, saved from one date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCleanTable } from '../../functions/_lib/cleanTable.ts';
import { bedCountRows } from '../../functions/_lib/bedPricing.ts';

const keys = bedCountRows().keys;
const row = (layout, basic, deep) => ({ layout, basic, deep });

test('a table splits into the Basic and the Deep rows, each with owner, guest and cleaner pay', () => {
  const set = checkCleanTable({
    effectiveFrom: '2026-11-01', note: ' YJ rates ',
    rows: [row('beds:2', { owner: 8000, guest: 8000, cost: 7000 }, { owner: 13800, guest: null, cost: 13800 })],
  }, keys);
  assert.deepEqual(set, {
    effectiveFrom: '2026-11-01', note: 'YJ rates',
    basic: [{ layout: 'beds:2', ownerPrice: 8000, guestPrice: 8000, internalCost: 7000 }],
    deep: [{ layout: 'beds:2', ownerPrice: 13800, guestPrice: null, internalCost: 13800 }],
  });
});

test('an empty cell is not set, never zero', () => {
  const set = checkCleanTable({ effectiveFrom: '2026-11-01', rows: [row('no_beds', {}, { cost: 5000 })] }, keys);
  assert.deepEqual(set.basic, [{ layout: 'no_beds', ownerPrice: null, guestPrice: null, internalCost: null }]);
  assert.deepEqual(set.deep, [{ layout: 'no_beds', ownerPrice: null, guestPrice: null, internalCost: 5000 }]);
});

test('refuses a bad date, an unknown or repeated row, and amounts that are not whole sen of zero or more', () => {
  const ok = row('beds:1', { owner: 6500 }, {});
  assert.equal(checkCleanTable({ effectiveFrom: '1 Nov', rows: [ok] }, keys).error.field, 'effectiveFrom');
  assert.equal(checkCleanTable({ effectiveFrom: '2026-11-01', rows: [] }, keys).error.field, 'rows');
  assert.equal(checkCleanTable({ effectiveFrom: '2026-11-01', rows: [row('bed:queen', {}, {})] }, keys).error.field, 'rows');
  assert.equal(checkCleanTable({ effectiveFrom: '2026-11-01', rows: [ok, ok] }, keys).error.field, 'rows');
  assert.equal(checkCleanTable({ effectiveFrom: '2026-11-01', rows: [row('beds:1', { owner: -1 }, {})] }, keys).error.field, 'rows');
  assert.equal(checkCleanTable({ effectiveFrom: '2026-11-01', rows: [row('beds:1', {}, { guest: 65.5 })] }, keys).error.field, 'rows');
  assert.equal(checkCleanTable(null, keys).error.field, 'rows');
});
