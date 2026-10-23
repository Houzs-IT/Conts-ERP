// node --test src/lib/rbac.test.mjs (npm test). The category-first rule in functions/_lib/access.ts against the
// owner's RBAC table of 23 Oct 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { AREAS, resolve, builtIn } = await import('../../functions/_lib/access.ts');

const area = key => AREAS.find(a => a.key === key);
const none = new Map();

test('built-in baselines follow the table', () => {
  const table = {
    dashboard: { management: 'full', operations_manager: 'full', operations_staff: 'none', finance_admin: 'view' },
    reservations: { management: 'full', operations_manager: 'full', operations_staff: 'edit', finance_admin: 'view' },
    scSales: { management: 'full', operations_manager: 'full', operations_staff: 'edit', finance_admin: 'view' },
    scInvoices: { management: 'full', operations_manager: 'view', operations_staff: 'none', finance_admin: 'full' },
    finance: { management: 'full', operations_manager: 'view', operations_staff: 'none', finance_admin: 'full' },
  };
  for (const [key, roles] of Object.entries(table)) {
    for (const [role, level] of Object.entries(roles)) assert.equal(builtIn(role, area(key)), level, `${role} ${key}`);
  }
});

test('a module inherits a chosen baseline and the handlers follow it', () => {
  const rows = new Map([['finance_admin:group:Operations', 'none']]);
  const r = resolve(rows, 'finance_admin', area('properties'));
  assert.deepEqual(r, { level: 'none', setting: 'inherit', groupLevel: 'none', chosen: true });
});

test('changing a baseline keeps an explicit override', () => {
  const rows = new Map([['operations_manager:group:Dream Crafter', 'view'], ['operations_manager:scSales', 'full']]);
  assert.equal(resolve(rows, 'operations_manager', area('scSales')).level, 'full');
  assert.equal(resolve(rows, 'operations_manager', area('scWarehouse')).level, 'view');
  // The built-in override on Invoices and payments still wins over the chosen baseline until it is set to inherit.
  assert.equal(resolve(rows, 'operations_manager', area('scInvoices')).level, 'view');
  rows.set('operations_manager:scInvoices', 'inherit');
  assert.equal(resolve(rows, 'operations_manager', area('scInvoices')).level, 'view');
  rows.set('operations_manager:group:Dream Crafter', 'edit');
  assert.equal(resolve(rows, 'operations_manager', area('scInvoices')).level, 'edit');
});

test('operations staff never resolve to Full, even from a stored row', () => {
  const rows = new Map([['operations_staff:group:Operations', 'full'], ['operations_staff:scSales', 'full']]);
  assert.equal(resolve(rows, 'operations_staff', area('reservations')).level, 'edit');
  assert.equal(resolve(rows, 'operations_staff', area('scSales')).level, 'edit');
});

test('field and owner roles stay out of every desk area', () => {
  for (const role of ['housekeeper', 'technician', 'owner']) assert.equal(resolve(none, role, area('dashboard')).level, 'none');
});
