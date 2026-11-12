// node --test src/lib/access.test.mjs. The department / position / user rule in functions/_lib/access.ts
// (resolveFor, PLAN.md "How a person's level in an area is worked out").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { AREAS, resolveFor, routeAreas, highestLevelOf, closedBySide } = await import('../../functions/_lib/access.ts');

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
  const r = rules({ user: { dashboard: 'full' }, department: { 'group:Home': 'full' } });
  for (const kind of ['cleaning', 'maintenance']) {
    for (const a of AREAS) assert.deepEqual(resolveFor(r, { kind }, a), { level: 'none', origin: 'none' });
  }
});

// The levels the rules migrations-pg/0145 seeds give, written out per area (they match the category chart the app had
// before departments: Operations staff, Operations manager and Finance admin columns). HR came later (migration 0165)
// and nobody is seeded into it: pay and bank details stay hidden until management grants HR.
const seeded = {
  operations_staff: { dashboard: 'none', portfolio: 'none', calendar: 'edit', reservations: 'edit', guests: 'edit', operations: 'edit', cleaning: 'edit', maintenance: 'edit', properties: 'edit', scheduledChanges: 'edit', agentToLet: 'edit', unitSettings: 'edit', hr: 'none', dcHr: 'none', serviceCases: 'edit', projects: 'edit', scSales: 'edit', scInvoices: 'none', scConsignment: 'edit', scProcurement: 'edit', scTransportPlan: 'edit', scWarehouse: 'edit', finance: 'none', deductions: 'none', owners: 'none', contracts: 'none', ledger: 'none', airbnbRecon: 'none', ownerClose: 'none', lockIncome: 'none', lockDeductions: 'none', lockO2: 'none', unlockStep: 'none', performance: 'edit', comms: 'edit', reports: 'none', pricing: 'edit', reviews: 'edit', automations: 'edit', mail: 'none', users: 'none', integrations: 'none', settings: 'none', health: 'none' },
  operations_manager: { dashboard: 'full', portfolio: 'full', calendar: 'full', reservations: 'full', guests: 'full', operations: 'full', cleaning: 'full', maintenance: 'full', properties: 'full', scheduledChanges: 'full', agentToLet: 'full', unitSettings: 'full', hr: 'none', dcHr: 'none', serviceCases: 'full', projects: 'full', scSales: 'full', scInvoices: 'view', scConsignment: 'full', scProcurement: 'full', scTransportPlan: 'full', scWarehouse: 'full', finance: 'view', deductions: 'view', owners: 'view', contracts: 'view', ledger: 'none', airbnbRecon: 'none', ownerClose: 'none', lockIncome: 'none', lockDeductions: 'none', lockO2: 'none', unlockStep: 'none', performance: 'full', comms: 'full', reports: 'view', pricing: 'full', reviews: 'full', automations: 'full', mail: 'none', users: 'full', integrations: 'full', settings: 'full', health: 'full' },
  finance_admin: { dashboard: 'view', portfolio: 'view', calendar: 'view', reservations: 'view', guests: 'view', operations: 'view', cleaning: 'view', maintenance: 'view', properties: 'view', scheduledChanges: 'view', agentToLet: 'view', unitSettings: 'view', hr: 'none', dcHr: 'none', serviceCases: 'view', projects: 'view', scSales: 'view', scInvoices: 'full', scConsignment: 'view', scProcurement: 'view', scTransportPlan: 'view', scWarehouse: 'view', finance: 'full', deductions: 'full', owners: 'full', contracts: 'full', ledger: 'full', airbnbRecon: 'none', ownerClose: 'none', lockIncome: 'none', lockDeductions: 'none', lockO2: 'none', unlockStep: 'none', performance: 'full', comms: 'none', reports: 'full', pricing: 'full', reviews: 'full', automations: 'none', mail: 'none', users: 'none', integrations: 'full', settings: 'full', health: 'full' },
};

test('the seeded rules give the levels of the old role chart', () => {
  // Migration 0172 copied each seeded Dream Crafter baseline to its three sidebar categories. Migration 0182 copied
  // Workspace to Home, Finance to Reports, Operations to Reservations and Units, and pinned the areas that changed
  // category (performance, comms, owners) to the level they had.
  const dc = level => ({ 'group:Service cases': level, 'group:Projects': level, 'group:Supply chain': level });
  const staffDept = {
    'group:Operations': 'edit', 'group:Reservations': 'edit', 'group:Units': 'edit', ...dc('edit'), 'group:Growth': 'edit',
    scInvoices: 'none', performance: 'edit', comms: 'edit', owners: 'none', contracts: 'none', deductions: 'none', airbnbRecon: 'none', ownerClose: 'none', lockIncome: 'none', lockDeductions: 'none', lockO2: 'none', unlockStep: 'none',
  };
  const financeDept = {
    'group:Home': 'view', 'group:Reports': 'full', 'group:Reservations': 'view', 'group:Operations': 'view', 'group:Units': 'view',
    ...dc('view'), 'group:Finance': 'full', 'group:Growth': 'full', 'group:System': 'full',
    scInvoices: 'full', comms: 'none', automations: 'none', users: 'none', performance: 'full', portfolio: 'view', owners: 'full', contracts: 'full', deductions: 'full', airbnbRecon: 'none', ownerClose: 'none', lockIncome: 'none', lockDeductions: 'none', lockO2: 'none', unlockStep: 'none',
  };
  const managerPosition = {
    'group:Home': 'full', 'group:Reports': 'view', 'group:Reservations': 'full', 'group:Operations': 'full', 'group:Units': 'full',
    ...dc('full'), 'group:Finance': 'view', 'group:Growth': 'full', 'group:System': 'full',
    scInvoices: 'view', ledger: 'none', performance: 'full', portfolio: 'full', comms: 'full', owners: 'view', contracts: 'view', deductions: 'view',
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

test('Messages sits in Growth beside Pricing, Reviews and Automations (owner, 2 Nov 2026; migration 0200)', () => {
  const growth = AREAS.filter(a => a.group === 'Growth').map(a => a.key);
  assert.deepEqual(growth, ['pricing', 'reviews', 'comms', 'automations']);
  assert.ok(!AREAS.some(a => a.group === 'Reservations' && a.key === 'comms'));
});

test('a Growth baseline does not reach Messages where migration 0200 pinned it', () => {
  // A department whose Reservations baseline gave Messages Edit and whose Growth baseline is View: 0200 stores comms Edit.
  const r = rules({ department: { 'group:Reservations': 'edit', 'group:Growth': 'view', comms: 'edit' } });
  assert.equal(resolveFor(r, staff, AREAS.find(a => a.key === 'comms')).level, 'edit');
  assert.equal(resolveFor(r, staff, AREAS.find(a => a.key === 'pricing')).level, 'view');
});

test('each page split off a shared area reaches its own endpoints and shares the ones its siblings use', () => {
  const keysFor = (method, path) => routeAreas(method, path)?.map(a => a.key) ?? null;
  const expected = [
    ['GET', '/api/reservations/calendar', ['calendar']],
    ['GET', '/api/guests', ['guests']],
    ['GET', '/api/operations/day', ['operations']],
    ['GET', '/api/housekeeping/board', ['cleaning']],
    ['GET', '/api/maintenance/issues', ['maintenance']],
    ['POST', '/api/housekeeping/guest-left', ['operations', 'cleaning']],
    ['GET', '/api/operations/service-prices', ['cleaning', 'maintenance']],
    ['PATCH', '/api/operations/service-prices/x1', ['cleaning', 'maintenance']],
    ['PATCH', '/api/maintenance/skus/x1', ['cleaning', 'maintenance']],
    ['POST', '/api/housekeeping/price-raise', ['cleaning', 'maintenance']],
    ['GET', '/api/units', null],
    ['GET', '/api/units/scheduled-changes', ['scheduledChanges']],
    ['PATCH', '/api/units/x1', ['properties']],
    ['PATCH', '/api/lettings/x1', ['properties', 'agentToLet']],
    ['POST', '/api/properties', ['properties', 'unitSettings']],
    ['GET', '/api/properties/x1/channels', ['properties']],
    ['GET', '/api/unit-layout-types', ['properties', 'unitSettings']],
    ['POST', '/api/unit-layout-types', ['unitSettings']],
    ['GET', '/api/contract-types', null],
    ['PATCH', '/api/contract-types/x1', ['unitSettings']],
    ['GET', '/api/contracts', ['contracts']],
    ['GET', '/api/owners', ['owners']],
    ['GET', '/api/finance/deductions', ['deductions']],
    ['POST', '/api/expenses', ['finance', 'deductions']],
    ['GET', '/api/finance/expenses', ['finance']],
    ['GET', '/api/reviews', ['reviews']],
    ['PUT', '/api/rates', ['pricing']],
    ['GET', '/api/employees/dream-crafter', ['dcHr']],
    ['PUT', '/api/employees/dream-crafter', ['dcHr']],
    ['GET', '/api/employees', ['hr']],
    ['GET', '/api/owner-close', ['ownerClose']],
  ];
  for (const [method, path, keys] of expected) assert.deepEqual(keysFor(method, path), keys, `${method} ${path}`);
});

test('a shared endpoint takes the highest level the person has on any of its pages', () => {
  const best = highestLevelOf([{ area: area('cleaning'), level: 'view' }, { area: area('maintenance'), level: 'edit' }]);
  assert.deepEqual([best.area.key, best.level], ['maintenance', 'edit']);
  const tie = highestLevelOf([{ area: area('cleaning'), level: 'none' }, { area: area('maintenance'), level: 'none' }]);
  assert.equal(tie.level, 'none');
});

test('each company closes the other one\'s HR: The Conts closes Dream Crafter HR, Dream Crafter closes HR', () => {
  assert.equal(closedBySide('staff', 'conts', 'Dream Crafter HR'), true);
  assert.equal(closedBySide('staff', 'dream_crafter', 'Dream Crafter HR'), false);
  assert.equal(closedBySide('staff', 'dream_crafter', 'HR'), true);
  assert.equal(closedBySide('management', 'conts', 'Dream Crafter HR'), false);
  assert.equal(area('dcHr').group, 'Dream Crafter HR');
  for (const key of ['ownerClose', 'lockIncome', 'lockDeductions', 'lockO2', 'unlockStep']) assert.equal(area(key).group, 'Units', key);
});
