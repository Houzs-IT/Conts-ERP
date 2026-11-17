// node --test src/lib/categoryCatalog.test.mjs. The product category catalog behind Category access
// (functions/_lib/categoryCatalog.ts): the catalog built from the engine's rows, and the request-body checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { catalogOfRows, catalogTree, parseCategoryAccess, rowsOfChoice, choiceOfRows, describeChoice } = await import('../../functions/_lib/categoryCatalog.ts');

const row = (group_code, group_label, sub_code = null, sub_label = null, sub_active = null) => ({ group_code, group_label, sub_code, sub_label, sub_active });
const catalog = catalogOfRows([
  row('WORKS', 'Works', 'PROTECTION', 'Protection', true),
  row('WORKS', 'Works', 'DOOR', 'Door', true),
  row('SOFT', 'Soft furnishing', 'CURTAIN_BLINDS', 'Curtain / blinds', true),
  row('SOFT', 'Soft furnishing', 'CARPET', 'Carpet', true),
  row('SOFT', 'Soft furnishing', 'OLD_RUG', 'Old rug', false),
  row('RAW', 'Raw material', 'CEMENT_SAND', 'Cement & sand', true),
  row('EMPTY', 'Not stocked yet'),
]);

test('the catalog keeps the engine order, a group with no sub-categories, and hidden sub-categories', () => {
  assert.deepEqual(catalog.map(group => group.code), ['WORKS', 'SOFT', 'RAW', 'EMPTY']);
  assert.deepEqual(catalog.find(group => group.code === 'EMPTY').subs, []);
  assert.deepEqual(catalog.find(group => group.code === 'SOFT').subs.at(-1), { code: 'OLD_RUG', label: 'Old rug', active: false });
});

test('the page tree lists every group and only shown sub-categories, codes and labels only', () => {
  const tree = catalogTree(catalog);
  assert.equal(tree.length, catalog.length);
  assert.deepEqual(tree[0].subs[0], { code: 'PROTECTION', label: 'Protection' });
  assert.deepEqual(tree[1].subs.map(sub => sub.code), ['CURTAIN_BLINDS', 'CARPET']);
});

test('a group the engine added can be ticked, whole or by sub-category', () => {
  const r = parseCategoryAccess({ restricted: true, groups: ['RAW'], subs: ['RAW/CEMENT_SAND', 'WORKS/DOOR'], other: false }, catalog);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { restricted: true, groups: ['RAW'], subs: ['WORKS/DOOR'], other: false });
});

test('a limited save keeps whole groups, sub-categories and uncategorised, and drops repeats', () => {
  const r = parseCategoryAccess({ restricted: true, groups: ['WORKS', 'WORKS'], subs: ['SOFT/CURTAIN_BLINDS'], other: true }, catalog);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { restricted: true, groups: ['WORKS'], subs: ['SOFT/CURTAIN_BLINDS'], other: true });
});

test('a sub-category whose group is ticked whole is dropped', () => {
  const r = parseCategoryAccess({ restricted: true, groups: ['SOFT'], subs: ['SOFT/CARPET', 'WORKS/DOOR'], other: false }, catalog);
  assert.ok(r.ok);
  assert.deepEqual(r.value.subs, ['WORKS/DOOR']);
});

test('unknown codes are refused, and OTHER is only the uncategorised flag', () => {
  assert.equal(parseCategoryAccess({ restricted: true, groups: ['NOPE'], subs: [], other: false }, catalog).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: ['OTHER'], subs: [], other: false }, catalog).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: [], subs: ['SOFT/DOOR'], other: false }, catalog).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: [], subs: ['SOFT'], other: false }, catalog).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: [1], subs: [], other: false }, catalog).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: 'WORKS', subs: [], other: false }, catalog).ok, false);
});

test('a limited save with nothing ticked is refused; uncategorised alone is enough', () => {
  assert.equal(parseCategoryAccess({ restricted: true, groups: [], subs: [], other: false }, catalog).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true }, catalog).ok, false);
  assert.ok(parseCategoryAccess({ restricted: true, groups: [], subs: [], other: true }, catalog).ok);
});

test('all categories needs no ticks and stores nothing', () => {
  const r = parseCategoryAccess({ restricted: false, groups: ['NOPE'], subs: [], other: true }, catalog);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { restricted: false, groups: [], subs: [], other: false });
  assert.equal(parseCategoryAccess({ groups: [] }, catalog).ok, false);
  assert.equal(parseCategoryAccess(null, catalog).ok, false);
});

test('a choice round-trips through its rows, and codes the catalog lost are left out', () => {
  const choice = { groups: ['WORKS'], subs: ['SOFT/CARPET'], other: true };
  const rows = rowsOfChoice(choice).map(r => ({ group_code: r.group, sub_code: r.sub }));
  assert.deepEqual(rows, [
    { group_code: 'WORKS', sub_code: null }, { group_code: 'SOFT', sub_code: 'CARPET' }, { group_code: 'OTHER', sub_code: null },
  ]);
  assert.deepEqual(choiceOfRows(rows, catalog), choice);
  assert.deepEqual(choiceOfRows([{ group_code: 'GONE', sub_code: null }, { group_code: 'SOFT', sub_code: 'GONE' }], catalog), { groups: [], subs: [], other: false });
});

test('a choice reads in words', () => {
  assert.equal(describeChoice(false, { groups: [], subs: [], other: false }, catalog), 'All categories');
  assert.equal(describeChoice(true, { groups: ['WORKS'], subs: ['SOFT/CURTAIN_BLINDS'], other: true }, catalog), 'Works, Soft furnishing / Curtain / blinds, Uncategorised');
});
