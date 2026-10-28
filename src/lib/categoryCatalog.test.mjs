// node --test src/lib/categoryCatalog.test.mjs. The product category catalog behind Category access
// (functions/_lib/categoryCatalog.ts): it must match the engine's catalog file, and the request-body checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { CATEGORY_CATALOG, catalogTree, parseCategoryAccess, rowsOfChoice, choiceOfRows, describeChoice } = await import('../../functions/_lib/categoryCatalog.ts');

// The engine file cannot be imported from here (it is another package), so its two tables are read as text.
const engine = readFileSync(new URL('../../engine/backend/src/scm/shared/renovation-catalog.ts', import.meta.url), 'utf8');
const block = (start, end) => engine.slice(engine.indexOf(start), engine.indexOf(end, engine.indexOf(start)));
const engineGroups = [...block('export const RENOVATION_GROUPS', '];').matchAll(/code: '([A-Z_]+)', label: '([^']*)'/g)].map(m => ({ code: m[1], label: m[2] }));
const engineSubs = [...block('export const SUB_CATEGORIES', '];').matchAll(/\{ group: '([A-Z_]+)', code: '([A-Z_]+)', label: '([^']*)', sort: (\d+)([^}]*)\}/g)]
  .map(m => ({ group: m[1], code: m[2], label: m[3], sort: Number(m[4]), active: !/active: false/.test(m[5]) }));

test('the catalog has every group and sub-category of the engine catalog, with the same labels and order', () => {
  assert.ok(engineGroups.length >= 8 && engineSubs.length >= 50, `read ${engineGroups.length} groups and ${engineSubs.length} sub-categories from the engine file`);
  assert.deepEqual(CATEGORY_CATALOG.map(g => ({ code: g.code, label: g.label })), engineGroups);
  const ours = CATEGORY_CATALOG.flatMap(g => g.subs.map(s => ({ group: g.code, code: s.code, label: s.label, sort: s.sort, active: s.active })));
  assert.deepEqual(ours, engineSubs);
});

test('the engine CATALOG_GROUPS list is the same set of groups', () => {
  const listed = [...block('export const CATALOG_GROUPS', ';').matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
  assert.deepEqual(CATEGORY_CATALOG.map(g => g.code), listed);
});

test('the page tree lists active groups and sub-categories in order, codes and labels only', () => {
  const tree = catalogTree();
  assert.equal(tree.length, CATEGORY_CATALOG.length);
  assert.deepEqual(tree[0].subs[0], { code: 'PROTECTION', label: 'Protection' });
});

test('a limited save keeps whole groups, sub-categories and uncategorised, and drops repeats', () => {
  const r = parseCategoryAccess({ restricted: true, groups: ['WORKS', 'WORKS'], subs: ['SOFT/CURTAIN_BLINDS'], other: true });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { restricted: true, groups: ['WORKS'], subs: ['SOFT/CURTAIN_BLINDS'], other: true });
});

test('a sub-category whose group is ticked whole is dropped', () => {
  const r = parseCategoryAccess({ restricted: true, groups: ['SOFT'], subs: ['SOFT/CARPET', 'WORKS/DOOR'], other: false });
  assert.ok(r.ok);
  assert.deepEqual(r.value.subs, ['WORKS/DOOR']);
});

test('unknown codes are refused, and OTHER is only the uncategorised flag', () => {
  assert.equal(parseCategoryAccess({ restricted: true, groups: ['NOPE'], subs: [], other: false }).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: ['OTHER'], subs: [], other: false }).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: [], subs: ['SOFT/DOOR'], other: false }).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: [], subs: ['SOFT'], other: false }).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: [1], subs: [], other: false }).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true, groups: 'WORKS', subs: [], other: false }).ok, false);
});

test('a limited save with nothing ticked is refused; uncategorised alone is enough', () => {
  assert.equal(parseCategoryAccess({ restricted: true, groups: [], subs: [], other: false }).ok, false);
  assert.equal(parseCategoryAccess({ restricted: true }).ok, false);
  assert.ok(parseCategoryAccess({ restricted: true, groups: [], subs: [], other: true }).ok);
});

test('all categories needs no ticks and stores nothing', () => {
  const r = parseCategoryAccess({ restricted: false, groups: ['NOPE'], subs: [], other: true });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { restricted: false, groups: [], subs: [], other: false });
  assert.equal(parseCategoryAccess({ groups: [] }).ok, false);
  assert.equal(parseCategoryAccess(null).ok, false);
});

test('a choice round-trips through its rows, and codes the catalog lost are left out', () => {
  const choice = { groups: ['WORKS'], subs: ['SOFT/CARPET'], other: true };
  const rows = rowsOfChoice(choice).map(r => ({ group_code: r.group, sub_code: r.sub }));
  assert.deepEqual(rows, [
    { group_code: 'WORKS', sub_code: null }, { group_code: 'SOFT', sub_code: 'CARPET' }, { group_code: 'OTHER', sub_code: null },
  ]);
  assert.deepEqual(choiceOfRows(rows), choice);
  assert.deepEqual(choiceOfRows([{ group_code: 'GONE', sub_code: null }, { group_code: 'SOFT', sub_code: 'GONE' }]), { groups: [], subs: [], other: false });
});

test('a choice reads in words', () => {
  assert.equal(describeChoice(false, { groups: [], subs: [], other: false }), 'All categories');
  assert.equal(describeChoice(true, { groups: ['WORKS'], subs: ['SOFT/CURTAIN_BLINDS'], other: true }), 'Works, Soft furnishing / Curtain / blinds, Uncategorised');
});
