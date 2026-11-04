// node --test src/lib/addUnitRules.test.mjs (npm test). What the Add unit page checks before each step's Next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FORM, stepProblems, stepOfField, stepAt, layoutToSave, hasInput } from '../pages/units/addUnitRules.ts';

const filled = { ...EMPTY_FORM, listingName: 'Studio at Arte', unitCode: 'A-12-03', buildingId: 'b1', purpose: 'rental' };

test('step 1 asks for the listing name, unit code, building and purpose', () => {
  assert.deepEqual(Object.keys(stepProblems(0, EMPTY_FORM)).sort(), ['buildingId', 'listingName', 'purpose', 'unitCode']);
  assert.deepEqual(stepProblems(0, filled), {});
  assert.ok(stepProblems(0, { ...filled, unitCode: '   ' }).unitCode);
});

test('the owner, address and used by are optional', () => {
  assert.deepEqual(stepProblems(0, { ...filled, ownerId: '', address: '', usedBy: '' }), {});
});

test('step 2 is open until a car park bay has no lot number', () => {
  assert.deepEqual(stepProblems(1, filled), {});
  assert.deepEqual(stepProblems(1, { ...filled, parkingBays: [{ lotNumber: '105', level: '2', note: null }] }), {});
  assert.ok(stepProblems(1, { ...filled, parkingBays: [{ lotNumber: ' ', level: null, note: null }] }).parkingBays);
});

test('a refused field sends the person back to the step it is on', () => {
  assert.equal(stepOfField('unitCode'), 0);
  assert.equal(stepOfField('buildingId'), 0);
  assert.equal(stepOfField('layoutType'), 1);
  assert.equal(stepOfField('parkingBays'), 1);
});

test('the Type saved is the one picked, else the suggestion if it is still offered', () => {
  assert.equal(layoutToSave('duplex', '1_bedroom', ['1_bedroom']), 'duplex');
  assert.equal(layoutToSave('', '1_bedroom', ['studio', '1_bedroom']), '1_bedroom');
  assert.equal(layoutToSave('', '1_bedroom', ['studio']), null);
  assert.equal(layoutToSave('', null, ['studio']), null);
});

test('only typed input counts for the leave warning, not the building from the link', () => {
  assert.equal(hasInput({ ...EMPTY_FORM, buildingId: 'b1' }, false), false);
  assert.equal(hasInput({ ...EMPTY_FORM, listingName: 'x' }, false), true);
  assert.equal(hasInput({ ...EMPTY_FORM, parkingBays: [{ lotNumber: '', level: null, note: null }] }, false), true);
  assert.equal(hasInput(EMPTY_FORM, true), true);
});

test('a step number worked out in code is held to the three steps', () => {
  assert.equal(stepAt(-1), 0);
  assert.equal(stepAt(0), 0);
  assert.equal(stepAt(1), 1);
  assert.equal(stepAt(2), 2);
  assert.equal(stepAt(3), 2);
});
