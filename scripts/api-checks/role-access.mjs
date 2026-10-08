// Editable permissions (Users and roles > Permissions): the chart shows the built-in levels until
// management chooses; a chosen level is enforced on the server and reaches the role's menu; only
// management can change it; every change is audited; putting a level back restores the built-in rule.
// Leaves role_access as it found it.
import { call, callAsUser, check, done } from './harness.mjs';

const staff = { userId: '11111111-1111-4111-8111-00000000aa01', email: 'ops-check@theconts.test', role: 'operations_staff' };
const cell = (chart, area, role) => chart?.areas?.find(a => a.key === area)?.roles?.[role];
const put = (changes, role = 'management') => call('PUT', '/api/users/access', { changes }, role);
const WAIT = 11_000; // the server keeps the chart for 10 seconds
const sleep = ms => new Promise(r => setTimeout(r, ms));

let r = await call('GET', '/api/users/access');
const start = r.json;
check('chart lists every area for the three editable roles', r.status === 200 && start.areas.length >= 20 && start.roles.join() === 'operations_manager,operations_staff,finance_admin' && start.canEdit === true, r.text.slice(0, 200));
const keep = ['finance', 'reservations', 'scInvoices'].map(area => ({ role: 'operations_staff', area, level: cell(start, area, 'operations_staff').chosen ? cell(start, area, 'operations_staff').level : null }));
await put(keep.map(k => ({ ...k, level: null })));
await sleep(WAIT);

r = await call('GET', '/api/users/access');
check('built-in: operations staff have no Finance, Edit on Reservations', cell(r.json, 'finance', 'operations_staff').level === 'none' && cell(r.json, 'reservations', 'operations_staff').level === 'edit' && !cell(r.json, 'finance', 'operations_staff').chosen, JSON.stringify(cell(r.json, 'finance', 'operations_staff')));
check('built-in: finance admin is Full on Finance, none on Operations', cell(r.json, 'finance', 'finance_admin').level === 'full' && cell(r.json, 'operations', 'finance_admin').level === 'none');

r = await callAsUser(staff, 'GET', '/api/users/access');
check('operations staff cannot see the chart (403)', r.status === 403, r.text);
r = await put([{ role: 'operations_staff', area: 'finance', level: 'full' }], 'finance_admin');
check('finance admin cannot change it (403)', r.status === 403, r.text);
r = await put([{ role: 'management', area: 'finance', level: 'none' }]);
check('management itself cannot be changed (400)', r.status === 400, r.text);
r = await put([{ role: 'housekeeper', area: 'finance', level: 'view' }]);
check('field roles cannot be changed (400)', r.status === 400, r.text);
r = await put([{ role: 'operations_staff', area: 'nowhere', level: 'view' }]);
check('unknown area refused (400)', r.status === 400, r.text);
r = await put([{ role: 'operations_staff', area: 'finance', level: 'owner' }]);
check('unknown level refused (400)', r.status === 400, r.text);

// Before any change: the built-in rules.
r = await callAsUser(staff, 'GET', '/api/finance/expenses');
const financeBefore = r.status;
check('built-in: operations staff refused on finance expenses', financeBefore === 403, `${r.status}`);
r = await call('GET', '/api/auth/session', undefined, 'finance_admin');
check('session carries the role’s levels', r.json?.user?.access?.comms === 'none' && r.json.user.access.finance === 'full', JSON.stringify(r.json?.user?.access));

// Open Finance to operations staff as view only; close Reservations to view only.
r = await put([{ role: 'operations_staff', area: 'finance', level: 'view' }, { role: 'operations_staff', area: 'reservations', level: 'view' }, { role: 'finance_admin', area: 'comms', level: 'view' }]);
check('management saves three changes', r.status === 200 && cell(r.json, 'finance', 'operations_staff').level === 'view' && cell(r.json, 'finance', 'operations_staff').chosen, r.text.slice(0, 200));
await sleep(WAIT);
r = await callAsUser(staff, 'GET', '/api/finance/expenses');
check('view on Finance: operations staff can now read expenses', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
r = await callAsUser(staff, 'POST', '/api/expenses', {});
check('view on Finance: a write is refused by the chart (403)', r.status === 403 && /view but not change/.test(r.text), r.text);
r = await callAsUser(staff, 'POST', '/api/reservations', {});
check('view on Reservations: a new booking is refused (403)', r.status === 403 && /Reservations/.test(r.text), r.text);
r = await callAsUser(staff, 'GET', '/api/reservations');
check('view on Reservations: reading still works', r.status === 200, `${r.status}`);
r = await call('GET', '/api/auth/session', undefined, 'finance_admin');
check('the new level reaches the session', r.json?.user?.access?.comms === 'view', JSON.stringify(r.json?.user?.access));
r = await call('POST', '/api/reservations', {});
check('management is untouched by the chart (not 403)', r.status !== 403, `${r.status}`);

// Invoices: closed to operations staff by the built-in rule, opened by a chosen level, closed again by none.
r = await callAsUser(staff, 'GET', '/api/sales-invoices');
check('built-in: operations staff refused on sales invoices', r.status === 403, `${r.status}`);
await put([{ role: 'operations_staff', area: 'scInvoices', level: 'view' }]);
await sleep(WAIT);
r = await callAsUser(staff, 'GET', '/api/sales-invoices');
check('view on Invoices: operations staff can read sales invoices', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);

r = await call('GET', '/api/system/health/audit-feed?range=24h&sensitive=1');
const logged = (r.json?.data ?? []).filter(e => e.action === 'user.permission_change');
check('each change is in the audit feed, with before and after', logged.length >= 3 && logged.some(e => e.after?.area === 'Finance' && e.after.level === 'view' && e.before?.level === 'none'), JSON.stringify(logged[0]));

// A rule that names roles itself (inventory: operations and management only) follows a chosen level.
r = await call('POST', '/api/inventory', {}, 'finance_admin');
check('built-in: finance admin cannot add inventory (403)', r.status === 403, );
await put([{ role: 'finance_admin', area: 'properties', level: 'edit' }]);
await sleep(WAIT);
r = await call('POST', '/api/inventory', {}, 'finance_admin');
check('Edit on Properties: finance admin reaches the inventory form checks (not 403)', r.status !== 403, );
r = await call('POST', '/api/users', {}, 'finance_admin');
check('inviting users stays with management whatever the chart says (403)', r.status === 403, );
await put([{ role: 'finance_admin', area: 'properties', level: null }]);

// Back to how it was.
r = await put([...keep, { role: 'finance_admin', area: 'comms', level: null }]);
check('putting the levels back succeeds', r.status === 200 && cell(r.json, 'finance', 'operations_staff').level === cell(start, 'finance', 'operations_staff').level, r.text.slice(0, 200));
await sleep(WAIT);
r = await callAsUser(staff, 'GET', '/api/finance/expenses');
check('back on the built-in rule: finance expenses refused again', r.status === financeBefore, `${r.status}`);
done();
