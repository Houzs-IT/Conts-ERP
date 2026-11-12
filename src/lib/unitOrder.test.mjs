// Run: NODE_OPTIONS=--experimental-strip-types npm test
// The Units screen and GET /api/units/detail?first=1 pick the same first unit with this rule (lib/unitOrder.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstUnitId } from './unitOrder.ts';

const u = (id, buildingId, unitCode, extra = {}) => ({ id, buildingId, unitCode, listingName: '', parentUnitId: null, ...extra });

test('states in name order, "State not set" last, then buildings by name, then units by code (numbers in order)', () => {
  const buildings = [
    { id: 'b1', name: 'Zeta', state: 'Selangor' },
    { id: 'b2', name: 'Alpha', state: '' },
    { id: 'b3', name: 'Beta', state: 'Kuala Lumpur' },
    { id: 'b4', name: 'Arc', state: 'Kuala Lumpur' },
  ];
  const units = [u('x', 'b2', 'A-1'), u('y', 'b3', 'B-1'), u('z2', 'b4', 'A-10'), u('z1', 'b4', 'A-9')];
  assert.equal(firstUnitId(buildings, units), 'z1');
});

test('a sub-unit is never the first unit; a building with only sub-units is passed over', () => {
  const buildings = [{ id: 'b1', name: 'A', state: 'KL' }, { id: 'b2', name: 'B', state: 'KL' }];
  const units = [u('child', 'b1', '0-1', { parentUnitId: 'p' }), u('top', 'b2', 'Z')];
  assert.equal(firstUnitId(buildings, units), 'top');
});

test('a unit with no code goes by its listing name; no units gives undefined', () => {
  const buildings = [{ id: 'b1', name: 'A', state: 'KL' }];
  assert.equal(firstUnitId(buildings, [u('n', 'b1', '', { listingName: 'beta' }), u('m', 'b1', 'Alpha')]), 'm');
  assert.equal(firstUnitId(buildings, []), undefined);
});
