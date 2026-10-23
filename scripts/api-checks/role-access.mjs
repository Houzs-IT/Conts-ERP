// Editable permissions (Users and roles > Permissions): access follows the department, then the position (migrations
// 0145, 0146). A stored rule is enforced on the server and reaches the person's menu; only management can change it;
// every change is audited; deleting a rule puts the department's level back. Operations staff are changed through the
// Operations Staff position so the Operations Manager is untouched. Leaves access_rules as it found it.
import { call, callAsUser, check, done } from './harness.mjs';

const staff = { userId: '11111111-1111-4111-8111-000000000004', email: 'weiwen@theconts.com', role: 'operations_staff' };
const FINANCE_PERSON = '11111111-1111-4111-8111-000000000003';
const put = (changes, role = 'management') => call('PUT', '/api/users/access', { changes }, role);
const levelOf = async (userId, area) => (await call('GET', `/api/users/${userId}/access`)).json?.areas?.find(a => a.key === area)?.level;
const WAIT = 11_000; // the server keeps the rules for 10 seconds
const sleep = ms => new Promise(r => setTimeout(r, ms));

let r = await call('GET', '/api/users/access');
const start = r.json;
const dept = name => start?.departments?.find(d => d.name === name);
const ops = dept('Operations'), finance = dept('Finance'), management = dept('Management');
const staffPos = ops?.positions.find(p => p.name === 'Operations Staff');
const areaCount = (start?.categories ?? []).reduce((n, c) => n + c.areas.length, 0);
check('chart lists every area and every department with its positions', r.status === 200 && areaCount >= 20 && !!ops && !!finance && !!management && !!staffPos && start.canEdit === true, r.text.slice(0, 200));
const stored = (scope, id, key) => start.rules[scope][id]?.[key] ?? null;
const touched = [['position', staffPos.id, 'finance'], ['position', staffPos.id, 'reservations'], ['position', staffPos.id, 'scInvoices'], ['department', finance.id, 'comms'], ['department', finance.id, 'properties']];
const keep = touched.map(([scope, scopeId, key]) => ({ scope, scopeId, key, level: stored(scope, scopeId, key) }));
await put(keep.filter(k => k.scope === 'position').map(k => ({ ...k, level: null })));
await sleep(WAIT);

check('seeded: operations staff have no Finance, Edit on Reservations', await levelOf(staff.userId, 'finance') === 'none' && await levelOf(staff.userId, 'reservations') === 'edit');
check('seeded: the Finance department is Full on Finance', await levelOf(FINANCE_PERSON, 'finance') === 'full');

r = await callAsUser(staff, 'GET', '/api/users/access');
check('operations staff cannot see the chart (403)', r.status === 403, r.text);
r = await put([{ scope: 'position', scopeId: staffPos.id, key: 'finance', level: 'full' }], 'finance_admin');
check('the Finance department cannot change it (403)', r.status === 403, r.text);
r = await put([{ scope: 'department', scopeId: management.id, key: 'finance', level: 'none' }]);
check('management itself cannot be changed (400)', r.status === 400, r.text);
r = await put([{ scope: 'department', scopeId: 'no-such-department', key: 'finance', level: 'view' }]);
check('an unknown department is refused (404)', r.status === 404, r.text);
r = await put([{ scope: 'position', scopeId: staffPos.id, key: 'nowhere', level: 'view' }]);
check('unknown area refused (400)', r.status === 400, r.text);
r = await put([{ scope: 'position', scopeId: staffPos.id, key: 'finance', level: 'owner' }]);
check('unknown level refused (400)', r.status === 400, r.text);

// Before any change: the seeded rules.
r = await callAsUser(staff, 'GET', '/api/finance/expenses');
const financeBefore = r.status;
check('seeded: operations staff refused on finance expenses', financeBefore === 403, `${r.status}`);
r = await call('GET', '/api/auth/session', undefined, 'finance_admin');
check('session carries the department’s levels', r.json?.user?.access?.comms === 'none' && r.json.user.access.finance === 'full', JSON.stringify(r.json?.user?.access));

// Open Finance to operations staff as view only; close Reservations to view only.
r = await put([
  { scope: 'position', scopeId: staffPos.id, key: 'finance', level: 'view' },
  { scope: 'position', scopeId: staffPos.id, key: 'reservations', level: 'view' },
  { scope: 'department', scopeId: finance.id, key: 'comms', level: 'view' },
]);
check('management saves three changes', r.status === 200 && r.json?.rules?.position?.[staffPos.id]?.finance === 'view', r.text.slice(0, 200));
await sleep(WAIT);
r = await callAsUser(staff, 'GET', '/api/finance/expenses');
check('view on Finance: operations staff can now read expenses', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
r = await callAsUser(staff, 'POST', '/api/expenses', {});
check('view on Finance: a write is refused (403)', r.status === 403 && /view only|view but not change/.test(r.text), r.text);
r = await callAsUser(staff, 'POST', '/api/reservations', {});
check('view on Reservations: a new booking is refused (403)', r.status === 403 && /Reservations/.test(r.text), r.text);
r = await callAsUser(staff, 'GET', '/api/reservations');
check('view on Reservations: reading still works', r.status === 200, `${r.status}`);
r = await call('GET', '/api/auth/session', undefined, 'finance_admin');
check('the new level reaches the session', r.json?.user?.access?.comms === 'view', JSON.stringify(r.json?.user?.access));
r = await call('POST', '/api/reservations', {});
check('management is untouched by the rules (not 403)', r.status !== 403, `${r.status}`);

// Invoices are Dream Crafter work; Operations is on The Conts side, so even a View rule leaves them closed.
r = await callAsUser(staff, 'GET', '/api/sales-invoices');
check('seeded: operations staff refused on sales invoices', r.status === 403, `${r.status}`);
await put([{ scope: 'position', scopeId: staffPos.id, key: 'scInvoices', level: 'view' }]);
await sleep(WAIT);
r = await callAsUser(staff, 'GET', '/api/sales-invoices');
check('view on Invoices: still closed, the department is on The Conts side', r.status === 403, `${r.status} ${r.text.slice(0, 120)}`);

r = await call('GET', '/api/system/health/audit-feed?range=24h&sensitive=1');
const logged = (r.json?.data ?? []).filter(e => e.action === 'user.permission_change');
check('each change is in the audit feed, with before and after', logged.length >= 3 && logged.some(e => e.after?.area === 'Finance' && e.after.level === 'view' && e.before?.level === null), JSON.stringify(logged[0]));

// A rule that names roles itself (inventory: operations and management only) follows the level.
r = await call('POST', '/api/inventory', {}, 'finance_admin');
check('seeded: the Finance department cannot add inventory (403)', r.status === 403, `${r.status}`);
await put([{ scope: 'department', scopeId: finance.id, key: 'properties', level: 'edit' }]);
await sleep(WAIT);
r = await call('POST', '/api/inventory', {}, 'finance_admin');
check('Edit on Units: the Finance department reaches the inventory form checks (not 403)', r.status !== 403, `${r.status}`);
r = await call('POST', '/api/users', {}, 'finance_admin');
check('inviting users stays with management whatever the rules say (403)', r.status === 403, `${r.status}`);

// Back to how it was.
r = await put(keep);
check('putting the levels back succeeds', r.status === 200 && (r.json?.rules?.position?.[staffPos.id]?.finance ?? null) === stored('position', staffPos.id, 'finance'), r.text.slice(0, 200));
await sleep(WAIT);
r = await callAsUser(staff, 'GET', '/api/finance/expenses');
check('back on the seeded rules: finance expenses refused again', r.status === financeBefore, `${r.status}`);
done();
