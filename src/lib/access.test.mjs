// node --test src/lib/access.test.mjs. The department / position / user rule in functions/_lib/access.ts
// (resolveFor, PLAN.md "How a person's level in an area is worked out").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { AREAS, resolveFor } = await import('../../functions/_lib/access.ts');

const area = key => AREAS.find(a => a.key === key);
const rules = ({ user = {}, position = {}, department = {} } = {}) => ({
  user: { rules: new Map(Object.entries(user)) },
  position: { rules: new Map(Object.entries(position)) },
  department: { rules: new Map(Object.entries(department)) },
});
const staff = { kind: 'staff' };
const at = (r, key) => resolveFor(r, staff, area(key));

test('precedence: user, position area, department area, position category, department category, none', () => {
  const all = rules({
    user: { scSales: 'view' },
    position: { scSales: 'edit', 'group:Supply chain': 'full' },
    department: { scSales: 'full', 'group:Supply chain': 'none' },
  });
  assert.deepEqual(at(all, 'scSales'), { level: 'view', origin: 'user' });
  all.user.rules.delete("scSales");
  assert.deepEqual(at(all, 'scSales'), { level: 'edit', origin: 'position' });
  all.position.rules.delete('scSales');
  assert.deepEqual(at(all, 'scSales'), { level: 'full', origin: 'department' });
  all.department.rules.delete('scSales');
  assert.deepEqual(at(all, 'scSales'), { level: 'full', origin: 'position' });
  all.position.rules.delete('group:Supply chain');
  assert.deepEqual(at(all, 'scSales'), { level: 'none', origin: 'department' });
  all.department.rules.delete('group:Supply chain');
  assert.deepEqual(at(all, 'scSales'), { level: 'none', origin: 'none' });
});

test('an area set at the department beats the position category baseline (Sales example)', () => {
  const r = rules({
    department: { 'group:Supply chain': 'view', scInvoices: 'none' },
    position: { 'group:Supply chain': 'edit' },
  });
  assert.deepEqual(at(r, 'scSales'), { level: 'edit', origin: 'position' });
  assert.deepEqual(at(r, 'scInvoices'), { level: 'none', origin: 'department' });
});

test('inherit counts as not set', () => {
  const r = rules({ user: { scSales: 'inherit' }, position: { scSales: 'inherit' }, department: { 'group:Supply chain': 'view' } });
  assert.deepEqual(at(r, 'scSales'), { level: 'view', origin: 'department' });
});

test('a person with no position falls to the department', () => {
  const r = rules({ department: { 'group:Operations': 'edit', reservations: 'view' } });
  assert.deepEqual(at(r, 'reservations'), { level: 'view', origin: 'department' });
  assert.deepEqual(at(r, 'operations'), { level: 'edit', origin: 'department' });
  assert.deepEqual(at(r, 'dashboard'), { level: 'none', origin: 'none' });
});

test('management is Full everywhere and nothing changes it', () => {
  const r = rules({ user: { finance: 'none' }, department: { 'group:Finance': 'none' } });
  for (const a of AREAS) assert.deepEqual(resolveFor(r, { kind: 'management' }, a), { level: 'full', origin: 'fixed' });
});

test('cleaning and maintenance have no desk areas, whatever is stored', () => {
  const r = rules({ user: { dashboard: 'full' }, department: { 'group:Workspace': 'full' } });
  for (const kind of ['cleaning', 'maintenance']) {
    for (const a of AREAS) assert.deepEqual(resolveFor(r, { kind }, a), { level: 'none', origin: 'none' });
  }
});

// The levels the rules migrations-pg/0145 seeds give, written out per area (they match the category chart the app had
// before departments: Operations staff, Operations manager and Finance admin columns). HR came later (migration 0165)
// and nobody is seeded into it: pay and bank details stay hidden until management grants HR.
const seeded = {
  operations_staff: { dashboard: 'none', portfolio: 'none', reservations: 'edit', operations: 'edit', properties: 'edit', hr: 'none', serviceCases: 'edit', projects: 'edit', scSales: 'edit', scInvoices: 'none', scConsignment: 'edit', scProcurement: 'edit', scTransportPlan: 'edit', scWarehouse: 'edit', finance: 'none', owners: 'none', ledger: 'none', performance: 'edit', comms: 'edit', users: 'none', integrations: 'none', settings: 'none', health: 'none' },
  operations_manager: { dashboard: 'full', portfolio: 'full', reservations: 'full', operations: 'full', properties: 'full', hr: 'none', serviceCases: 'full', projects: 'full', scSales: 'full', scInvoices: 'view', scConsignment: 'full', scProcurement: 'full', scTransportPlan: 'full', scWarehouse: 'full', finance: 'view', owners: 'view', ledger: 'none', performance: 'full', comms: 'full', users: 'full', integrations: 'full', settings: 'full', health: 'full' },
  finance_admin: { dashboard: 'view', portfolio: 'view', reservations: 'view', operations: 'view', properties: 'view', hr: 'none', serviceCases: 'view', projects: 'view', scSales: 'view', scInvoices: 'full', scConsignment: 'view', scProcurement: 'view', scTransportPlan: 'view', scWarehouse: 'view', finance: 'full', owners: 'full', ledger: 'full', performance: 'full', comms: 'none', users: 'none', integrations: 'full', settings: 'full', health: 'full' },
};

test('the seeded rules give the levels of the old role chart', () => {
  // Migration 0172 copied each seeded Dream Crafter baseline to its three sidebar categories.
  const dc = level => ({ 'group:Service cases': level, 'group:Projects': level, 'group:Supply chain': level });
  const staffDept = { 'group:Operations': 'edit', ...dc('edit'), 'group:Growth': 'edit', scInvoices: 'none' };
  const financeDept = {
    'group:Workspace': 'view', 'group:Operations': 'view', ...dc('view'), 'group:Finance': 'full',
    'group:Growth': 'full', 'group:System': 'full', scInvoices: 'full', comms: 'none', users: 'none',
  };
  const managerPosition = {
    'group:Workspace': 'full', 'group:Operations': 'full', ...dc('full'), 'group:Finance': 'view',
    'group:Growth': 'full', 'group:System': 'full', scInvoices: 'view', ledger: 'none',
  };
  const people = {
    operations_staff: rules({ department: staffDept }),
    operations_manager: rules({ department: staffDept, position: managerPosition }),
    finance_admin: rules({ department: financeDept }),
  };
  for (const [role, r] of Object.entries(people)) {
    assert.equal(Object.keys(seeded[role]).length, AREAS.length, `${role} lists every area`);
    for (const a of AREAS) assert.equal(resolveFor(r, staff, a).level, seeded[role][a.key], `${role} ${a.key}`);
  }
});
