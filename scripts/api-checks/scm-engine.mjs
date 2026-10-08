// Sign-on from Property OS into the supply chain engine: who is offered it, who is refused, that the
// session the engine opens is for the same person, and that the engine refuses a sign-on it cannot verify.
// Needs the local engine on :8790 (engine/backend) and this app started with SCM_ENGINE_API,
// SCM_ENGINE_SITE and SCM_ENGINE_SSO_SECRET pointing at it.
import { call, callAsUser, check, done } from './harness.mjs';

const E = 'http://localhost:8790';
let r = await call('GET', '/api/supply-chain/engine');
check('engine offered to management', r.status === 200 && r.json?.enabled === true, r.text.slice(0, 200));
r = await call('GET', '/api/supply-chain/engine', undefined, 'housekeeper');
check('not offered to a housekeeper', r.status === 200 && r.json?.enabled === false, r.text);
r = await call('POST', '/api/supply-chain/engine-session', {}, 'housekeeper');
check('housekeeper refused a session (403)', r.status === 403, r.text);
r = await callAsUser({ userId: '11111111-1111-4111-8111-000000000008', email: 'limck@example.com', role: 'owner' }, 'POST', '/api/supply-chain/engine-session', {});
check('owner refused a session (403)', r.status === 403, r.text);

r = await call('POST', '/api/supply-chain/engine-session', {});
check('management gets an engine session and the site to open', r.status === 200 && !!r.json?.token && /^http/.test(r.json?.site ?? ''), r.text.slice(0, 200));
const auth = { authorization: `Bearer ${r.json?.token}` };
const me = await (await fetch(E + '/api/auth/me', { headers: auth })).json().catch(() => ({}));
check('the engine session is the same person', me.user?.email === 'management@theconts.com', JSON.stringify(me).slice(0, 300));
const so = await fetch(E + '/api/scm/mfg-sales-orders?limit=1', { headers: auth });
check('and can read sales orders', so.status === 200, String(so.status));
r = await call('POST', '/api/supply-chain/engine-session', {}, 'operations_manager');
check('operations manager gets a session', r.status === 200 && !!r.json?.token, r.text.slice(0, 150));

const post = body => fetch(E + '/api/conts-sso', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const forged = Buffer.from(JSON.stringify({ email: 'attacker@example.com', name: 'x', role: 'management', exp: Date.now() + 30000 })).toString('base64url') + '.AAAA';
check('a forged sign-on is refused by the engine (401)', (await post({ assertion: forged })).status === 401);
check('an empty sign-on is refused (401)', (await post({})).status === 401);

done();
