// The staging account switcher (functions/api/auth/view-as.ts). Run twice against a local server:
//   node scripts/api-checks/view-as.mjs off   server started without VIEW_AS (as production is)
//   node scripts/api-checks/view-as.mjs on    server started with --binding VIEW_AS=staging
// "on" writes one audit row per switch, and makes the staging test account for each role it switches to.
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
check('...and cannot switch into management (404)', r.status === 404 && (await whoAmI(b))?.role === 'operations_manager', `${r.status}`);
r = await b('POST', '/api/auth/view-as', { role: 'management' });
check('...nor into a role (404)', r.status === 404 && (await whoAmI(b))?.role === 'operations_manager', `${r.status}`);

b = browser(MGMT);
r = await b('GET', '/api/auth/view-as');
const users = r.json?.users ?? [];
check('management gets the list of active accounts', r.json?.enabled === true && users.length > 1 && r.json.viewing === null && r.json.me.id === MGMT.userId, r.text.slice(0, 200));
const pick = role => users.find(u => u.role === role);
const finance = pick('finance_admin'), owner = pick('owner'), field = pick('housekeeper') ?? pick('technician');

r = await b('POST', '/api/auth/view-as', { userId: finance.id });
check('switch to a finance admin: sent to their landing screen', r.status === 200 && r.json?.home === '/owners?view=statements', r.text);
let me = await whoAmI(b);
check('now signed in as that finance admin, with their access levels', me?.id === finance.id && me.role === 'finance_admin' && me.access?.operations === 'none', JSON.stringify(me));
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
  check('switch to a field account', r.status === 200 && r.json?.home === '/worker/today' && (await whoAmI(b))?.id === field.id, r.text);
}
// By role: each staff role lands on its own test account and its own home screen, twice in a row on the same account.
const HOMES = { management: '/', operations_manager: '/', operations_staff: '/operations/today', finance_admin: '/owners?view=statements', housekeeper: '/worker/today', technician: '/worker/today' };
check('every staff role is offered by role, and owner is not', JSON.stringify([...(await b('GET', '/api/auth/view-as')).json?.roles ?? []].sort()) === JSON.stringify(Object.keys(HOMES).sort()));
const madeIds = {};
for (const [role, home] of Object.entries(HOMES)) {
  r = await b('POST', '/api/auth/view-as', { role });
  me = await whoAmI(b);
  madeIds[role] = me?.id;
  check(`by role ${role}: on the test account, at ${home}`, r.status === 200 && r.json?.home === home && me?.role === role && me.email === `role-${role.replace(/_/g, '-')}@staging.invalid` && me.fullName.startsWith('Test: '), `${r.text} ${JSON.stringify(me)}`);
}
r = await b('POST', '/api/auth/view-as', { role: 'housekeeper' });
check('the same role again reuses its test account', (await whoAmI(b))?.id === madeIds.housekeeper);
r = await b('GET', '/api/auth/view-as');
check('...and the switcher says which role is being viewed', r.json?.viewing?.role === 'housekeeper' && r.json.viewing.fullName === 'Test: Cleaner' && r.json.me.id === MGMT.userId, r.text.slice(0, 200));
r = await b('GET', '/api/account');
check('viewing adds no signed-in device to the viewed account', Array.isArray(r.json?.devices) && r.json.devices.length === 0, JSON.stringify(r.json?.devices));
r = await b('POST', '/api/auth/view-as', { role: 'owner' });
check('owner is not a test-account role (400)', r.status === 400, `${r.status} ${r.text}`);
r = await b('POST', '/api/auth/view-as', { role: 'superuser' });
check('an unknown role is refused (400)', r.status === 400, `${r.status} ${r.text}`);
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'role-housekeeper@staging.invalid', password: '!' }) });
check('a test account cannot be signed in to with a password', login.status >= 400 && !login.headers.getSetCookie().some(c => /^tc_session=[^;]+/.test(c) && !/Max-Age=0/.test(c)), `${login.status}`);

// An invited account that has not chosen a password yet only ever shows "Set a new password": refused, and marked in the list.
const mgmt = browser(MGMT);
const invited = await mgmt('POST', '/api/users', { email: `invited-${Date.now()}@example.com`, fullName: 'Invited Not Set Up', role: 'technician' });
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
check('each test account was made once, logged under the real person', made.length === 6 && made.every(e => e.actor_id === MGMT.userId), JSON.stringify(made[0]));
done();
