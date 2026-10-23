// node --test src/lib/accessRules.test.mjs. The request-body checks of the department, rule and per-person access
// endpoints (functions/_lib/accessRules.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const {
  cleanName, parseRuleChanges, parsePersonChanges, parseDepartmentMove, parsePositionMove, ruleKeyKind, closedBySide, isUniqueViolation,
} = await import('../../functions/_lib/accessRules.ts');

const rule = (over = {}) => ({ scope: 'department', scopeId: 'd1', key: 'scSales', level: 'edit', ...over });

test('names are trimmed and spaces collapsed; empty and long ones are refused', () => {
  assert.equal(cleanName('  Sales   Team '), 'Sales Team');
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('x'.repeat(81)), null);
  assert.equal(cleanName('x'.repeat(80)), 'x'.repeat(80));
  assert.equal(cleanName(5), null);
});

test('rule keys: an area, a category, or nothing', () => {
  assert.equal(ruleKeyKind('scSales'), 'area');
  assert.equal(ruleKeyKind('group:Dream Crafter'), 'group');
  assert.equal(ruleKeyKind('group:Nope'), null);
  assert.equal(ruleKeyKind('nope'), null);
});

test('rule changes: levels, inherit on an area, null deletes', () => {
  const ok = parseRuleChanges({ changes: [rule(), rule({ scope: 'position', scopeId: 'p1', key: 'finance', level: 'inherit' }), rule({ key: 'group:Finance', level: null })] });
  assert.ok(ok.ok);
  assert.equal(ok.value.length, 3);
  assert.equal(ok.value[2].level, null);
});

test('rule changes: a category never takes inherit', () => {
  assert.equal(parseRuleChanges({ changes: [rule({ key: 'group:Finance', level: 'inherit' })] }).ok, false);
  assert.equal(parseRuleChanges({ changes: [rule({ key: 'group:Finance', level: 'view' })] }).ok, true);
});

test('rule changes: bad scope, key, level or shape are refused', () => {
  for (const bad of [
    rule({ scope: 'user' }), rule({ scope: 'role' }), rule({ scopeId: '' }), rule({ scopeId: 7 }),
    rule({ key: 'nope' }), rule({ level: 'admin' }), rule({ level: undefined }),
  ]) assert.equal(parseRuleChanges({ changes: [bad] }).ok, false, JSON.stringify(bad));
  for (const body of [null, {}, { changes: 'x' }, { changes: [] }, { changes: [null] }, { changes: Array.from({ length: 301 }, () => rule()) }]) {
    assert.equal(parseRuleChanges(body).ok, false);
  }
});

test('rule changes: the last change to a cell wins', () => {
  const r = parseRuleChanges({ changes: [rule({ level: 'view' }), rule({ level: 'full' })] });
  assert.ok(r.ok);
  assert.equal(r.value.length, 1);
  assert.equal(r.value[0].level, 'full');
});

test('person changes: levels or null per area, or reset all', () => {
  assert.deepEqual(parsePersonChanges({ resetAll: true }), { ok: true, value: { resetAll: true } });
  const r = parsePersonChanges({ changes: [{ area: 'finance', level: 'view' }, { area: 'users', level: null }] });
  assert.ok(r.ok && !r.value.resetAll);
  assert.equal(r.value.changes.length, 2);
});

test('person changes: no inherit, no category keys, no unknown areas', () => {
  for (const c of [{ area: 'finance', level: 'inherit' }, { area: 'group:Finance', level: 'view' }, { area: 'nope', level: 'view' }, { area: 'finance' }]) {
    assert.equal(parsePersonChanges({ changes: [c] }).ok, false, JSON.stringify(c));
  }
  assert.equal(parsePersonChanges({ resetAll: false }).ok, false);
  assert.equal(parsePersonChanges(null).ok, false);
});

test('moveTo: absent is fine, malformed is not', () => {
  assert.deepEqual(parseDepartmentMove(null), { ok: true, value: null });
  assert.deepEqual(parseDepartmentMove({}), { ok: true, value: null });
  assert.deepEqual(parseDepartmentMove({ moveTo: { departmentId: 'd2', positionId: null } }), { ok: true, value: { departmentId: 'd2', positionId: null } });
  assert.deepEqual(parseDepartmentMove({ moveTo: { departmentId: 'd2' } }), { ok: true, value: { departmentId: 'd2', positionId: null } });
  assert.equal(parseDepartmentMove({ moveTo: { positionId: 'p1' } }).ok, false);
  assert.equal(parseDepartmentMove({ moveTo: { departmentId: 'd2', positionId: 4 } }).ok, false);
  assert.deepEqual(parsePositionMove({ moveTo: { positionId: null } }), { ok: true, value: { positionId: null } });
  assert.deepEqual(parsePositionMove({ moveTo: { positionId: 'p2' } }), { ok: true, value: { positionId: 'p2' } });
  assert.deepEqual(parsePositionMove(undefined), { ok: true, value: null });
  assert.equal(parsePositionMove({ moveTo: 'p2' }).ok, false);
});

test('the side closes the other side\'s categories, never for management', () => {
  assert.equal(closedBySide('staff', 'conts', 'Dream Crafter'), true);
  assert.equal(closedBySide('staff', 'conts', 'Operations'), false);
  assert.equal(closedBySide('staff', 'dream_crafter', 'Growth'), true);
  assert.equal(closedBySide('staff', 'both', 'Dream Crafter'), false);
  assert.equal(closedBySide('management', 'conts', 'Dream Crafter'), false);
});

test('a unique-index clash is recognised', () => {
  assert.equal(isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' })), true);
  assert.equal(isUniqueViolation(new Error('other')), false);
  assert.equal(isUniqueViolation(null), false);
});
