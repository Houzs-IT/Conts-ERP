import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRoleLevels, rulesToWrite, tierState, raiseTo, lowerBelow, countGrants, countChanged, areaKeysOf,
} from './roleGrid.ts';

const categories = [
  { group: 'Operations', areas: [{ key: 'operations', label: 'Operations', managed: false }] },
  { group: 'Units', areas: [{ key: 'properties', label: 'Units', managed: false }, { key: 'owners', label: 'Owners', managed: false }] },
  { group: 'Finance', areas: [{ key: 'finance', label: 'Finance', managed: true }] },
];
const keys = areaKeysOf(categories);

test('a role with no rules anywhere has no access', () => {
  assert.deepEqual(resolveRoleLevels(categories, {}), { operations: 'none', properties: 'none', owners: 'none', finance: 'none' });
});

test('a department category baseline reaches every area under it', () => {
  const levels = resolveRoleLevels(categories, { 'group:Units': 'edit' });
  assert.equal(levels.properties, 'edit');
  assert.equal(levels.owners, 'edit');
  assert.equal(levels.operations, 'none');
});

test('a position area setting beats the department area setting', () => {
  const levels = resolveRoleLevels(categories, { operations: 'full' }, { operations: 'view' });
  assert.equal(levels.operations, 'view');
});

test('a department area setting beats a position category baseline, so a closed door stays closed', () => {
  const levels = resolveRoleLevels(categories, { owners: 'none' }, { 'group:Units': 'edit' });
  assert.equal(levels.owners, 'none');
  assert.equal(levels.properties, 'edit');
});

test('inherit counts as not set', () => {
  const levels = resolveRoleLevels(categories, { 'group:Units': 'view' }, { properties: 'inherit' });
  assert.equal(levels.properties, 'view');
});

test('saving writes every area that is not already stored at the chosen level, including none', () => {
  const desired = { operations: 'edit', properties: 'none', owners: 'view', finance: 'none' };
  const written = rulesToWrite(categories, { operations: 'edit', owners: 'inherit' }, desired);
  assert.deepEqual(written, [
    { key: 'properties', level: 'none' },
    { key: 'owners', level: 'view' },
    { key: 'finance', level: 'none' },
  ]);
});

test('saving writes nothing when every area is already stored at the chosen level', () => {
  const desired = { operations: 'edit', properties: 'none', owners: 'none', finance: 'none' };
  const stored = { operations: 'edit', properties: 'none', owners: 'none', finance: 'none' };
  assert.deepEqual(rulesToWrite(categories, stored, desired), []);
});

test('a tier is on, off or mixed across a group', () => {
  const levels = { operations: 'none', properties: 'edit', owners: 'view', finance: 'none' };
  assert.equal(tierState(levels, ['properties', 'owners'], 'view'), 'on');
  assert.equal(tierState(levels, ['properties', 'owners'], 'edit'), 'mixed');
  assert.equal(tierState(levels, ['properties', 'owners'], 'full'), 'off');
});

test('raising to a tier never lowers an area that is already higher', () => {
  const levels = { operations: 'none', properties: 'full', owners: 'view', finance: 'none' };
  const next = raiseTo(levels, ['properties', 'owners'], 'edit');
  assert.equal(next.properties, 'full');
  assert.equal(next.owners, 'edit');
  assert.equal(next.finance, 'none');
});

test('lowering below a tier drops to the level under it and leaves lower areas alone', () => {
  const levels = { operations: 'none', properties: 'full', owners: 'view', finance: 'none' };
  assert.equal(lowerBelow(levels, ['properties', 'owners'], 'full').properties, 'edit');
  assert.equal(lowerBelow(levels, ['properties', 'owners'], 'view').properties, 'none');
  assert.equal(lowerBelow(levels, ['properties', 'owners'], 'edit').owners, 'view');
});

test('grants count areas with any access and areas with full', () => {
  const levels = { operations: 'full', properties: 'edit', owners: 'none', finance: 'full' };
  assert.deepEqual(countGrants(levels, keys), { granted: 3, full: 2, available: 4 });
});

test('changed areas are the ones that differ from the saved levels', () => {
  const saved = { operations: 'none', properties: 'view', owners: 'view', finance: 'none' };
  const draft = { operations: 'none', properties: 'edit', owners: 'view', finance: 'full' };
  assert.equal(countChanged(saved, draft, keys), 2);
});
