// The staging account switcher (functions/api/auth/view-as.ts). Run twice against a local server:
//   node scripts/api-checks/view-as.mjs off   server started without VIEW_AS (as production is)
//   node scripts/api-checks/view-as.mjs on    server started with --binding VIEW_AS=staging
// "on" writes one audit row per switch, and makes the staging test account for each department it switches to.
import { createHmac } from 'node:crypto';
import { check, done } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = u => { const body = Buffer.from(JSON.stringify({ ...u, exp: Date.now() + 36e5, iat: Date.now() })).toString('base64').replace(/=+$/, ''); return `${body}.${b64(createHmac('sha256', 'smoke-test-secret-not-real-0123456789').update(body).digest())}`; };
const MGMT = { userId: '11111111-1111-4111-8111-000000000002', email: 'management@theconts.com', role: 'management', fullName: 'Test Bot (management)' };
const OPS_MGR = { userId: '11111111-1111-4111-8111-000000000001', email: 'aina@theconts.com', role: 'operations_manager', fullName: 'Aina Zulkifli' };

/** A tiny cookie jar, so a switch carries over to the next call the way a browser's would. */
function browser(session) {
  const jar = new Map([['tc_session', sign(session)]]);
  return async (method, path, body, host) => {
    const r = await fetch(BASE + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(host ? { host } : {}) },
    });
    for (const c of r.headers.getSetCookie()) {
      const [, k, v] = /^([^=]+)=([^;]*)/.exec(c);
      if (v === '' || /Max-Age=0/.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t, jar };
  };
}
const whoAmI = async b => (await b('GET', '/api/auth/session')).json?.user;

const mode = process.argv[2];
if (mode === 'off') {
  const b = browser(MGMT);
  let r = await b('GET', '/api/auth/view-as');
  check('off: the switcher reports it is not available', r.status === 200 && r.json?.enabled === false && !r.json.users, r.text.slice(0, 200));
  r = await b('POST', '/api/auth/view-as', { userId: OPS_MGR.userId });
  check('off: switching is refused, even for management (404)', r.status === 404, `${r.status} ${r.text}`);
  r = await b('POST', '/api/auth/view-as', { role: 'housekeeper' });
  check('off: switching by role is refused too (404), and makes no test account', r.status === 404, `${r.status} ${r.text}`);
  r = await b('GET', '/api/users');
  check('off: no test account exists', !JSON.stringify(r.json ?? {}).includes('@staging.invalid'), r.text.slice(0, 200));
  check('off: still signed in as management', (await whoAmI(b))?.role === 'management');
  done();
}

let b = browser(OPS_MGR);
let r = await b('GET', '/api/auth/view-as');
check('an operations manager is not offered the switcher', r.json?.enabled === false, r.text.slice(0, 200));
r = await b('POST', '/api/auth/view-as', { userId: MGMT.userId });
check('...and cannot switch into management (404)', r.status === 404 && (await whoAmI(b))?.id === OPS_MGR.userId, `${r.status}`);
r = await b('POST', '/api/auth/view-as', { role: 'management' });
check('...nor into a department (404)', r.status === 404 && (await whoAmI(b))?.id === OPS_MGR.userId, `${r.status}`);

b = browser(MGMT);
r = await b('GET', '/api/auth/view-as');
const users = r.json?.users ?? [];
const departments = r.json?.departments ?? [];
check('management gets the list of active accounts and departments', r.json?.enabled === true && users.length > 1 && departments.length > 1 && r.json.viewing === null && r.json.me.id === MGMT.userId, r.text.slice(0, 200));
const finance = users.find(u => u.department === 'Finance'), owner = users.find(u => u.role === 'owner'), field = users.find(u => u.role === 'housekeeper' || u.role === 'technician');

r = await b('POST', '/api/auth/view-as', { userId: finance.id });
check('switch to a Finance person: sent to their landing screen', r.status === 200 && r.json?.home === '/owners?view=statements', r.text);
let me = await whoAmI(b);
check('now signed in as that person, with their department’s levels', me?.id === finance.id && me.department === 'Finance' && me.access?.finance === 'full', JSON.stringify(me));
r = await b('GET', '/api/auth/view-as');
check('the switcher is still offered while viewing as them, and says who', r.json?.enabled === true && r.json.viewing?.id === finance.id && r.json.me.id === MGMT.userId, r.text.slice(0, 200));

if (owner) {
  r = await b('POST', '/api/auth/view-as', { userId: owner.id });
  check('switch straight on to an owner', r.status === 200 && r.json?.home === '/owner' && (await whoAmI(b))?.role === 'owner', r.text);
  r = await b('GET', '/api/users');
  check('as the owner, staff screens are refused as they would be for the owner', r.status === 403, `${r.status}`);
  r = await b('GET', '/api/auth/view-as');
  check('...yet the way back is still there', r.json?.enabled === true && r.json.viewing?.id === owner.id, r.text.slice(0, 200));
}
if (field) {
  r = await b('POST', '/api/auth/view-as', { userId: field.id });
  check('switch to a field account', r.status === 200 && r.json?.home === '/portal/today' && (await whoAmI(b))?.id === field.id, r.text);
}
// By department: each one lands on its own test account (with its first position) and its own home screen.
const homeOf = d => d.kind === 'management' ? '/' : d.kind === 'cleaning' || d.kind === 'maintenance' ? '/portal/today'
  : d.name === 'Finance' ? '/owners?view=statements' : d.side === 'dream_crafter' ? '/sales/orders' : '/operations/today';
const madeIds = {};
for (const d of departments) {
  const pos = d.positions[0] ?? null;
  r = await b('POST', '/api/auth/view-as', { departmentId: d.id, positionId: pos?.id ?? null });
  me = await whoAmI(b);
  madeIds[d.id] = me?.id;
  const name = `Test: ${d.name}${pos ? ` / ${pos.name}` : ''}`;
  check(`by department ${d.name}: on the test account, at ${homeOf(d)}`, r.status === 200 && r.json?.home === homeOf(d) && me?.department === d.name && /@staging\.invalid$/.test(me.email) && me.fullName === name, `${r.text} ${JSON.stringify(me)}`);
}
const cleaning = departments.find(d => d.kind === 'cleaning');
r = await b('POST', '/api/auth/view-as', { departmentId: cleaning.id, positionId: cleaning.positions[0]?.id ?? null });
check('the same department again reuses its test account', (await whoAmI(b))?.id === madeIds[cleaning.id]);
r = await b('GET', '/api/auth/view-as');
check('...and the switcher says who is being viewed', r.json?.viewing?.role === 'housekeeper' && r.json.viewing.fullName.startsWith(`Test: ${cleaning.name}`) && r.json.me.id === MGMT.userId, r.text.slice(0, 200));
r = await b('GET', '/api/account');
check('viewing adds no signed-in device to the viewed account', Array.isArray(r.json?.devices) && r.json.devices.length === 0, JSON.stringify(r.json?.devices));
r = await b('POST', '/api/auth/view-as', { role: 'housekeeper' });
check('the old { role } still opens the first department of that kind', r.status === 200 && (await whoAmI(b))?.role === 'housekeeper', `${r.status} ${r.text}`);
r = await b('POST', '/api/auth/view-as', { role: 'owner' });
check('owner is not a test-account role (400)', r.status === 400, `${r.status} ${r.text}`);
r = await b('POST', '/api/auth/view-as', { role: 'superuser' });
check('an unknown role is refused (400)', r.status === 400, `${r.status} ${r.text}`);
const testEmail = (await whoAmI(b))?.email ?? '';
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: testEmail, password: '!' }) });
check('a test account cannot be signed in to with a password', /@staging\.invalid$/.test(testEmail) && login.status >= 400 && !login.headers.getSetCookie().some(c => /^tc_session=[^;]+/.test(c) && !/Max-Age=0/.test(c)), `${testEmail} ${login.status}`);

// An invited account that has not chosen a password yet only ever shows "Set a new password": refused, and marked in the list.
const mgmt = browser(MGMT);
const admin = departments.find(d => d.name === 'Admin');
const invited = await mgmt('POST', '/api/users', { email: `invited-${Date.now()}@example.com`, fullName: 'Invited Not Set Up', side: 'both', departmentId: admin.id, positionId: admin.positions[0]?.id ?? null });
const invitedId = invited.json?.id ?? invited.json?.userId ?? invited.json?.data?.id;
r = await mgmt('GET', '/api/auth/view-as');
check('an invited account not set up yet is marked as such', r.json?.users?.find(u => u.id === invitedId)?.notSetUp === true, `${invited.status} ${invited.text.slice(0, 200)}`);
r = await mgmt('POST', '/api/auth/view-as', { userId: invitedId });
check('...and viewing it is refused (400)', r.status === 400 && r.json?.error?.code === 'NOT_SET_UP', `${r.status} ${r.text}`);

r = await b('POST', '/api/auth/view-as', { userId: 'no-such-account' });
check('an unknown account is refused (400)', r.status === 400, `${r.status} ${r.text}`);

r = await b('POST', '/api/auth/view-as', { userId: MGMT.userId });
check('back to me: management again, at the dashboard', r.status === 200 && r.json?.home === '/' && (await whoAmI(b))?.id === MGMT.userId, r.text);
check('...and the second cookie is gone', !r.jar.has('tc_origin'), [...r.jar.keys()].join());

// The live-address refusal (doorFor) cannot be exercised against localhost: the Host header is not ours to set.

r = await b('GET', '/api/system/health/audit-feed?range=24h&sensitive=1');
check('each switch is in the audit feed under the real person', (r.json?.data ?? []).some(e => e.action === 'user.view_as' && e.after?.viewedAs === finance.fullName), JSON.stringify((r.json?.data ?? []).find(e => e.action === 'user.view_as')));
const made = (r.json?.data ?? []).filter(e => e.action === 'user.view_as_test_account');
// One per department switched to, plus the department-only account the old { role } switch opened.
check('each test account was made once, logged under the real person', made.length === departments.length + 1 && made.every(e => e.actor_id === MGMT.userId), `${made.length} of ${departments.length + 1} ${JSON.stringify(made[0])}`);
done();
