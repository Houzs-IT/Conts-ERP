// node --test src/lib/twoStepLegacy.test.mjs. The old two-step role list turned into departments and the owners switch.
// (resolveFor, PLAN.md "How a person's level in an area is worked out").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { departmentsForLegacyRoles, legacyRolesIncludeOwners, parseList } = await import('../../functions/_lib/twoStepLegacy.ts');
const { twoStepRequired } = await import('../../functions/_lib/auth.ts');

// In sort order, as the settings handler and the migration read them.
const departments = [
  { id: 'mgmt', name: 'Management', kind: 'management' },
  { id: 'ops', name: 'Operations', kind: 'staff' },
  { id: 'fin', name: 'Finance', kind: 'staff' },
  { id: 'sales', name: 'Sales', kind: 'staff' },
  { id: 'clean', name: 'Cleaning', kind: 'cleaning' },
  { id: 'maint', name: 'Maintenance', kind: 'maintenance' },
  { id: 'crew', name: 'Linen crew', kind: 'cleaning' },
];
const ids = roles => departmentsForLegacyRoles(roles, departments);

test('each old role maps to the departments it stood for', () => {
  assert.deepEqual(ids(['management']), ['mgmt']);
  assert.deepEqual(ids(['operations_staff']), ['ops', 'fin', 'sales']);
  assert.deepEqual(ids(['finance_admin']), ['fin']);
  assert.deepEqual(ids(['operations_manager']), ['ops']);
  assert.deepEqual(ids(['housekeeper']), ['clean', 'crew']);
  assert.deepEqual(ids(['technician']), ['maint']);
  assert.deepEqual(ids(['owner']), []);
});

test('a list is the union, in department order, and nothing repeats', () => {
  assert.deepEqual(ids(['technician', 'finance_admin', 'operations_staff', 'management']), ['mgmt', 'ops', 'fin', 'sales', 'maint']);
  assert.deepEqual(ids([]), []);
  assert.deepEqual(ids(['nobody']), []);
});

test('owners have no department, so the list asks for them by name', () => {
  assert.equal(legacyRolesIncludeOwners(parseList('management, owner')), true);
  assert.equal(legacyRolesIncludeOwners(parseList('management,operations_staff')), false);
  assert.deepEqual(parseList(' a, ,b,'), ['a', 'b']);
});

const settings = (over = {}) => ({ require2faRoles: [], require2faDepartments: null, require2faOwners: false, ...over });

test('twoStepRequired: owners follow their own switch, staff their department', () => {
  const s = settings({ require2faDepartments: ['fin'], require2faOwners: true });
  assert.equal(twoStepRequired(s, { role: 'owner' }), true);
  assert.equal(twoStepRequired(s, { role: 'operations_staff', departmentId: 'fin' }), true);
  assert.equal(twoStepRequired(s, { role: 'operations_staff', departmentId: 'ops' }), false);
  assert.equal(twoStepRequired(settings({ require2faDepartments: ['fin'] }), { role: 'owner' }), false);
});

test('twoStepRequired: until departments are saved the old role list answers', () => {
  const s = settings({ require2faRoles: ['operations_manager'] });
  assert.equal(twoStepRequired(s, { role: 'operations_manager', departmentId: 'ops' }), true);
  assert.equal(twoStepRequired(s, { role: 'operations_staff', departmentId: 'ops' }), false);
});
