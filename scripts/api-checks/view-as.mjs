// The staging account switcher (functions/api/auth/view-as.ts). Run twice against a local server:
//   node scripts/api-checks/view-as.mjs off   server started without VIEW_AS (as production is)
//   node scripts/api-checks/view-as.mjs on    server started with --binding VIEW_AS=staging
// "on" writes one audit row per switch and nothing else.
import { createHmac } from 'node:crypto';
import { check, done } from './harness.mjs';

const BASE = 'http://localhost:8788';
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
  check('off: still signed in as management', (await whoAmI(b))?.role === 'management');
  done();
}

let b = browser(OPS_MGR);
let r = await b('GET', '/api/auth/view-as');
check('an operations manager is not offered the switcher', r.json?.enabled === false, r.text.slice(0, 200));
r = await b('POST', '/api/auth/view-as', { userId: MGMT.userId });
check('...and cannot switch into management (404)', r.status === 404 && (await whoAmI(b))?.role === 'operations_manager', `${r.status}`);

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
  check('switch to a field account', r.status === 200 && r.json?.home === '/field/today' && (await whoAmI(b))?.id === field.id, r.text);
}
r = await b('POST', '/api/auth/view-as', { userId: 'no-such-account' });
check('an unknown account is refused (400)', r.status === 400, `${r.status} ${r.text}`);

r = await b('POST', '/api/auth/view-as', { userId: MGMT.userId });
check('back to me: management again, at the dashboard', r.status === 200 && r.json?.home === '/' && (await whoAmI(b))?.id === MGMT.userId, r.text);
check('...and the second cookie is gone', !r.jar.has('tc_origin'), [...r.jar.keys()].join());

// The live-address refusal (doorFor) cannot be exercised against localhost: the Host header is not ours to set.

r = await b('GET', '/api/system/health/audit-feed?range=24h&sensitive=1');
check('each switch is in the audit feed under the real person', (r.json?.data ?? []).some(e => e.action === 'user.view_as' && e.after?.viewedAs === finance.fullName), JSON.stringify((r.json?.data ?? []).find(e => e.action === 'user.view_as')));
done();
