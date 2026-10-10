// Saved table views (functions/api/table-layouts, migration 0094): own views, company views, defaults, role checks,
// validation and the audit trail. Runs against the seeded local server (harness defaults), or any local server:
//   API_BASE=http://127.0.0.1:8792 API_EMAIL=dev@local.test API_PASSWORD=... SESSION_SECRET=<that server's> node scripts/api-checks/table-layouts.mjs
// SESSION_SECRET is needed to act as a second, non-management account the script invites. Local only.
import { createHmac } from 'node:crypto';
import { check, done } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const SECRET = process.env.SESSION_SECRET ?? 'smoke-test-secret-not-real-0123456789';
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (u) => { const body = Buffer.from(JSON.stringify({ ...u, exp: Date.now() + 36e5, iat: Date.now() })).toString('base64').replace(/=+$/, ''); return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`; };

let manager;
if (process.env.API_EMAIL) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.API_EMAIL, password: process.env.API_PASSWORD }) });
  manager = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
} else {
  manager = sign({ userId: '11111111-1111-4111-8111-000000000002', email: 'management@theconts.com', role: 'management', fullName: 'Test Bot (management)' });
}
async function call(cookie, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
const M = (m, p, b) => call(manager, m, p, b);

const me = (await M('GET', '/api/auth/session')).json;
check('signed in as management', me?.user?.role === 'management' || me?.role === 'management', JSON.stringify(me).slice(0, 200));

const table = `check.${Date.now().toString(36)}`;
const layout = { columns: [{ key: 'reference', hidden: false }, { key: 'guest', hidden: true }], sort: 'gross:desc', pageSize: 100, filters: { view: 'all', ch: 'airbnb' } };

let r = await M('GET', `/api/table-layouts?table=${table}`);
check('empty table: no views, management may share', r.status === 200 && r.json.mine.length === 0 && r.json.company.length === 0 && r.json.canShare === true, r.text);

r = await M('GET', '/api/table-layouts?table=Bad%20Key');
check('a malformed table key is refused', r.status === 422, r.text);

r = await M('POST', '/api/table-layouts', { table, name: 'Airbnb by value', layout, scope: 'mine', isDefault: true });
const mine = r.json;
check('save a personal default view', r.status === 201 && mine.scope === 'mine' && mine.isDefault && mine.layout.sort === 'gross:desc' && mine.layout.filters.ch === 'airbnb', r.text);

r = await M('POST', '/api/table-layouts', { table, name: '  airbnb BY value ', layout: { ...layout, sort: 'gross:asc' }, scope: 'mine', isDefault: true });
check('saving under the same name (any case) replaces it, same id', r.status === 200 && r.json.id === mine.id && r.json.layout.sort === 'gross:asc', r.text);

r = await M('POST', '/api/table-layouts', { table, name: 'Second', layout, scope: 'mine', isDefault: true });
const second = r.json;
r = await M('GET', `/api/table-layouts?table=${table}`);
check('only one personal default at a time', r.json.mine.filter(v => v.isDefault).length === 1 && r.json.mine.find(v => v.isDefault).id === second.id, r.text);

r = await M('POST', '/api/table-layouts', { table, name: 'Company arrivals', layout, scope: 'company', isDefault: true });
const company = r.json;
check('management saves a company default', r.status === 201 && company.scope === 'company' && company.isDefault, r.text);

r = await M('POST', '/api/table-layouts', { table, name: 'x', layout: { columns: 'nope' }, scope: 'mine' });
check('a layout with bad columns is refused', r.status === 422, r.text);
r = await M('POST', '/api/table-layouts', { table, name: 'x', layout: { columns: [], filters: { 'bad key!': 'a' } }, scope: 'mine' });
check('a filter with a bad parameter name is refused', r.status === 422, r.text);
r = await M('POST', '/api/table-layouts', { table, name: '   ', layout, scope: 'mine' });
check('a blank name is refused', r.status === 422 && r.json.error.fields?.name, r.text);

r = await M('PATCH', `/api/table-layouts/${second.id}`, { name: 'Airbnb by value' });
check('renaming onto another view\'s name is refused', r.status === 409, r.text);
r = await M('PATCH', `/api/table-layouts/${second.id}`, { name: 'Renamed', isDefault: false });
check('rename and drop the default', r.status === 200 && r.json.name === 'Renamed' && !r.json.isDefault, r.text);

// A second account without a management role.
const email = `views-${Date.now().toString(36)}@local.test`;
r = await M('POST', '/api/users', { email, fullName: 'Views Check Staff', role: 'operations_staff' });
check('invite an operations staff account to test with', r.status === 201, r.text);
const staff = sign({ userId: r.json?.id, email, role: 'operations_staff', fullName: 'Views Check Staff' });
const S = (m, p, b) => call(staff, m, p, b);

r = await S('GET', `/api/table-layouts?table=${table}`);
check('staff see company views but not management\'s personal ones, and may not share', r.status === 200 && r.json.mine.length === 0 && r.json.company.some(v => v.id === company.id) && r.json.canShare === false, r.text);
r = await S('POST', '/api/table-layouts', { table, name: 'Shared by staff', layout, scope: 'company' });
check('staff cannot save a company view', r.status === 403, r.text);
r = await S('PATCH', `/api/table-layouts/${company.id}`, { isDefault: false });
check('staff cannot change a company view', r.status === 403, r.text);
r = await S('DELETE', `/api/table-layouts/${mine.id}`);
check('staff cannot see or delete someone else\'s view', r.status === 404, r.text);
r = await S('POST', '/api/table-layouts', { table, name: 'My own', layout, scope: 'mine', isDefault: true });
const staffView = r.json;
check('staff save their own default', r.status === 201 && staffView.isDefault, r.text);
r = await M('GET', `/api/table-layouts?table=${table}`);
check('management does not see staff\'s personal view, and keeps its own default flags', !r.json.mine.some(v => v.id === staffView.id) && r.json.company.find(v => v.id === company.id)?.isDefault, r.text);

r = await M('DELETE', `/api/table-layouts/${second.id}`);
check('delete own view', r.status === 200 && r.json.deleted, r.text);
r = await M('DELETE', `/api/table-layouts/${second.id}`);
check('deleting again says it is gone', r.status === 404, r.text);

r = await M('GET', '/api/system/health/audit-feed?range=24h&limit=200');
const feed = JSON.stringify(r.json ?? {});
check('changes are in the audit trail', r.status === 200 && /table_view\.(create|update|delete)/.test(feed), feed.slice(0, 300));

// Export mode of the paged lists: one request can carry up to 1,000 rows, so the table's Export reads every row.
r = await M('GET', '/api/reservations?view=all&size=25');
const allBookings = r.json.total;
r = await M('GET', '/api/reservations?view=all&export=1&size=1000');
check('bookings export mode: pages of 1,000', r.status === 200 && r.json.pageSize === 1000 && r.json.data.length === Math.min(1000, allBookings), `${r.json?.pageSize} ${r.json?.data?.length}`);
r = await M('GET', '/api/reservations?view=all&size=1000');
check('without export mode the page size stays capped', r.json.pageSize === 50, String(r.json?.pageSize));
r = await M('GET', '/api/reservations?view=all&grossMin=5000');
check('guest total filter (RM) keeps only bookings at or above it', r.status === 200 && r.json.data.every(x => x.grossBookingValue >= 500000) && r.json.total < allBookings, String(r.json?.total));
r = await M('GET', '/api/guests?export=1&size=1000');
check('guests export mode: pages of 1,000', r.status === 200 && r.json.pageSize === 1000, String(r.json?.pageSize));

// Bulk assign: one cleaner, many cleans; field roles refused; a clash is skipped with a reason.
let tasks = (await M('GET', '/api/tasks?state=active&kind=cleaning&pageSize=3')).json?.data ?? [];
if (!tasks.length) {
  // Imported data has every clean finished: open two by hand (local database only).
  const unit = (await M('GET', '/api/units')).json?.data?.[0];
  for (const time of ['09:00', '13:00']) if (unit) await M('POST', '/api/housekeeping/tasks', { unitId: unit.id, kind: 'deep_clean', scheduledFor: time, dueAt: time.replace(/^(\d+)/, h => String(Number(h) + 2).padStart(2, '0')) });
  tasks = (await M('GET', '/api/tasks?state=active&kind=cleaning&pageSize=3')).json?.data ?? [];
}
const cleaners = (await M('GET', '/api/housekeeping/cleaners?active=1')).json?.data ?? [];
if (tasks.length && cleaners.length) {
  r = await M('POST', '/api/tasks/bulk-assign', { taskIds: tasks.map(t => t.id), cleanerId: cleaners[0].id, force: true });
  check('bulk assign gives every ticked clean to the cleaner', r.status === 200 && r.json.assigned === tasks.length, r.text);
  r = await M('GET', '/api/system/health/audit-feed?range=24h&limit=200');
  check('bulk assign is audited per task and as a whole', /task\.assign_cleaner/.test(r.text) && /task\.bulk_assign/.test(r.text), r.text.slice(0, 200));
} else console.log('skip bulk assign: no open cleans or no cleaners in this data');
r = await M('POST', '/api/tasks/bulk-assign', { taskIds: [], cleanerId: 'x' });
check('bulk assign with nothing ticked is refused', r.status === 422, r.text);
r = await M('POST', '/api/tasks/bulk-assign', { reservationIds: ['no-such-booking'], cleanerId: cleaners[0]?.id ?? 'x' });
check('a booking with no open clean is named, not failed', cleaners.length === 0 ? r.status === 422 : r.status === 200 && r.json.assigned === 0 && r.json.skipped.length === 1, r.text);
const hkEmail = `views-hk-${Date.now().toString(36)}@local.test`;
r = await M('POST', '/api/users', { email: hkEmail, fullName: 'Views Check Housekeeper', role: 'housekeeper' });
const hk = sign({ userId: r.json?.id, email: hkEmail, role: 'housekeeper', fullName: 'Views Check Housekeeper' });
r = await call(hk, 'POST', '/api/tasks/bulk-assign', { taskIds: tasks.map(t => t.id), cleanerId: cleaners[0]?.id ?? 'x' });
check('field roles cannot bulk assign', r.status === 403, r.text);
r = await call(hk, 'GET', `/api/table-layouts?table=${table}`);
check('field roles have no saved views', r.status === 403, r.text);

for (const v of [mine, company]) await M('DELETE', `/api/table-layouts/${v.id}`);
await S('DELETE', `/api/table-layouts/${staffView.id}`);
done();
