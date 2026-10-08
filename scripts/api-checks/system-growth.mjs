// Run against a local server signed in as dev@local.test (the real-data database from hostplatform-import.mjs --serve):
//   node scripts/api-checks/system-growth.mjs http://127.0.0.1:8802 .dev.vars
// Creates one throwaway user (revoke-*@local.test) and switches it off. Local only.
// Role change and deactivation take effect on the very next request (UI audit C11).
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const B = (process.argv[2] ?? 'http://127.0.0.1:8802') + '/api';
const secret = /SESSION_SECRET="?([^"\n]+)"?/.exec(readFileSync(process.argv[3] ?? '.dev.vars', 'utf8'))[1];
const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mint = s => { const body = Buffer.from(JSON.stringify({ ...s, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, ''); return `tc_session=${body}.${b64(createHmac('sha256', secret).update(body).digest())}`; };
const login = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dev@local.test', password: 'LocalTest1' }) });
const admin = login.headers.get('set-cookie').split(';')[0];
const call = async (cookie, method, path, body) => { const r = await fetch(B + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, text: await r.text() }; };
let fails = 0; const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : ' :: ' + x}`); };

const email = `revoke-${Date.now()}@local.test`;
let r = await call(admin, 'POST', '/users', { fullName: 'Revoke Check', email, role: 'finance_admin' });
check('invite a finance admin', r.status === 201, r.text);
const id = JSON.parse(r.text).id;
const cookie = mint({ userId: id, email, role: 'finance_admin', fullName: 'Revoke Check' });
r = await call(cookie, 'GET', '/payouts'); check('finance admin can read payouts', r.status === 200, r.status + r.text.slice(0, 100));
r = await call(admin, 'PATCH', `/users/${id}`, { role: 'operations_staff' }); check('management changes role to operations staff', r.status === 200, r.text);
r = await call(cookie, 'GET', '/payouts'); check('same cookie, next request: payouts refused (role read live)', r.status === 403, r.status + r.text.slice(0, 120));
r = await call(admin, 'PATCH', `/users/${id}`, { isActive: false }); check('management switches the account off', r.status === 200, r.text);
r = await call(cookie, 'GET', '/nav/badges'); check('same cookie, next request: 401', r.status === 401, r.status + r.text.slice(0, 120));
r = await call(mint({ userId: 'no-such-user', email: 'x@x', role: 'management', fullName: 'Ghost' }), 'GET', '/nav/badges'); check('a signed cookie for a user who does not exist: 401', r.status === 401, r.status);
r = await call(admin, 'GET', '/nav/badges'); check('management still works', r.status === 200, r.status);

// Search by OTA reference, payout run guard, owner reveal permission.
const ref = (JSON.parse((await call(admin, 'GET', '/reservations?view=all&size=50')).text).data.find(x => x.externalRef) ?? {}).externalRef;
r = await call(admin, 'GET', `/search?q=${encodeURIComponent(ref.toLowerCase())}`);
check('search finds a booking by its OTA reference (any case)', JSON.parse(r.text).some(h => h.kind === 'reservation' && h.ref === ref), r.text.slice(0, 200));
r = await call(admin, 'POST', '/payouts/run', { payoutIds: [] }); check('payout run needs at least one payout', r.status === 422, r.status);
const owners = JSON.parse((await call(admin, 'GET', '/owners')).text).data;
check('owner list never carries a full IC or bank account', owners.every(o => o.ic === null && o.bankAccount === null), JSON.stringify(owners[0]).slice(0, 200));
check('owner list carries the last four only', owners.some(o => o.bankAccountLast4 && o.bankAccountLast4.length === 4), '');
const auto = JSON.parse((await call(admin, 'GET', '/automations')).text).data;
check('automations: guest messages are not reported as running', auto.filter(a => a.id.startsWith('guest.')).every(a => a.running === false && a.blockedBy), '');
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0);
