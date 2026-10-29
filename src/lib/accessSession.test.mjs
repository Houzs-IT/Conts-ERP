// node --test src/lib/accessSession.test.mjs. accessFor / levelsFor of functions/_lib/access.ts: the session's department,
// position and kind decide the level, the side closes the other side's categories afterwards, management sees both sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { accessFor, levelsFor, levelAt, mayIn, canManage, refusalFor, roleForKind, kindOf, forgetRules } = await import('../../functions/_lib/access.ts');

/** An env whose database answers every query with these access_rules rows. */
const envWith = rows => ({ TX: { unsafe: async () => rows } });
const rule = (scope, area, level) => ({ scope, area, level });
const staff = (over = {}) => ({ userId: 'u1', role: 'operations_staff', departmentId: 'd1', positionId: 'p1', kind: 'staff', side: 'both', ...over });
const SO = '/api/sales-orders';

test('roleForKind gives the hidden role', () => {
  assert.equal(roleForKind('management'), 'management');
  assert.equal(roleForKind('staff'), 'operations_staff');
  assert.equal(roleForKind('cleaning'), 'housekeeper');
  assert.equal(roleForKind('maintenance'), 'technician');
});

test('a cookie without a kind falls back to the role', () => {
  assert.equal(kindOf({ role: 'management' }), 'management');
  assert.equal(kindOf({ role: 'housekeeper' }), 'cleaning');
  assert.equal(kindOf({ role: 'technician' }), 'maintenance');
  assert.equal(kindOf({ role: 'operations_staff' }), 'staff');
  assert.equal(kindOf({ role: 'operations_staff', kind: 'management' }), 'management');
});

test('staff level comes from the rules and always counts as chosen', async () => {
  forgetRules();
  const env = envWith([rule('department', 'group:Supply chain', 'view'), rule('position', 'scSales', 'edit')]);
  const a = await accessFor(env, staff(), SO);
  assert.equal(a.level, 'edit');
  assert.equal(a.chosen, true);
  // Nothing set for another area: No access, still chosen, so the handler follows it.
  const none = await accessFor(env, staff(), '/api/finance/payables');
  assert.deepEqual([none.level, none.chosen], ['none', true]);
});

test('the side closes the other side after the rules resolve, and is never opened by them', async () => {
  forgetRules();
  const env = envWith([rule('department', 'group:Supply chain', 'full'), rule('department', 'group:Operations', 'edit')]);
  const conts = await accessFor(env, staff({ side: 'conts' }), SO);
  assert.deepEqual([conts.level, conts.chosen], ['none', true]);
  const dc = await accessFor(env, staff({ side: 'dream_crafter' }), '/api/reservations');
  assert.deepEqual([dc.level, dc.chosen], ['none', true]);
  const both = await accessFor(env, staff(), SO);
  assert.equal(both.level, 'full');
  // A side does not give what the rules do not: Dream Crafter side, nothing set for Finance.
  assert.equal((await accessFor(env, staff({ side: 'dream_crafter' }), '/api/finance/payables')).level, 'none');
});

test('management is full on both sides and its access is not "chosen"', async () => {
  const env = envWith([]);
  const m = { userId: 'm1', role: 'management', departmentId: 'dm', positionId: null, kind: 'management', side: 'conts' };
  const a = await accessFor(env, m, SO);
  assert.deepEqual([a.level, a.chosen, a.staff], ['full', false, false]);
  assert.equal(canManage('management', a), true);
  assert.equal(refusalFor(a, 'DELETE'), null);
  const lv = await levelsFor(env, m);
  assert.ok(Object.values(lv).every(l => l === 'full'));
});

test('field accounts and owners keep no desk areas and no refusal text', async () => {
  const env = envWith([rule('department', 'group:Operations', 'full')]);
  const cleaner = { userId: 'c1', role: 'housekeeper', departmentId: 'dc', positionId: null, kind: 'cleaning', side: 'conts' };
  const a = await accessFor(env, cleaner, '/api/reservations');
  assert.deepEqual([a.level, a.chosen], ['none', false]);
  assert.equal(refusalFor(a, 'GET'), null);
  assert.equal(canManage('housekeeper', a), false);
  const owner = { userId: 'o1', role: 'owner', side: 'both' };
  assert.ok(Object.values(await levelsFor(env, owner)).every(l => l === 'none'));
});

test('refusals and canManage follow the staff level', async () => {
  forgetRules();
  const env = envWith([rule('department', 'scSales', 'view'), rule('department', 'users', 'view'), rule('department', 'dashboard', 'full')]);
  const view = await accessFor(env, staff(), SO);
  assert.match(refusalFor(view, 'POST') ?? '', /view only/);
  assert.equal(refusalFor(view, 'GET'), null);
  // Users is a managed area: any access carries its management-only actions. Sales order is not.
  assert.equal(canManage('operations_staff', view), false);
  assert.equal(canManage('operations_staff', await accessFor(env, staff(), '/api/users')), true);
  assert.equal(canManage('operations_staff', await accessFor(env, staff(), '/api/dashboard')), true);
  const closed = await accessFor(env, staff(), '/api/finance/payables');
  assert.match(refusalFor(closed, 'GET') ?? '', /does not include/);
});

test('levelAt and mayIn read one area for another request path', async () => {
  forgetRules();
  const env = envWith([rule('position', 'finance', 'view'), rule('department', 'group:Finance', 'edit')]);
  assert.equal(await levelAt(env, staff(), 'finance'), 'view');
  assert.equal(await mayIn(env, staff(), 'finance', 'view'), true);
  assert.equal(await mayIn(env, staff(), 'finance', 'edit'), false);
  assert.equal(await mayIn(env, staff(), 'owners', 'edit'), true);
  assert.equal(await mayIn(env, { userId: 'm', role: 'management', side: 'conts' }, 'finance', 'full'), true);
});
