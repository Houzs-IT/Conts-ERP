// Phone and 6-digit PIN sign-in for field staff (PR #364), end to end: who may give app access, sign-in, first PIN, lockout, New PIN.
//
// Run on a throwaway database only (it adds accounts, cleaners, technicians and jobs):
//   node scripts/dev-pglite.mjs   (leave running), a local server on it (wrangler pages dev dist with
//   CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE pointing at it), then
//   API_BASE=http://localhost:8788 DB_URL=postgres://pos_app:local@127.0.0.1:55441/postgres node scripts/api-checks/field-pin-sign-in.mjs
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const DB_URL = process.env.DB_URL ?? 'postgres://pos_app:local@127.0.0.1:55441/postgres';
const SECRET = process.env.SESSION_SECRET
  ?? (existsSync(join(ROOT, '.dev.vars')) ? /SESSION_SECRET\s*=\s*"?([^"\r\n]+)"?/.exec(readFileSync(join(ROOT, '.dev.vars'), 'utf8'))?.[1] : undefined);
if (!SECRET) { console.error('Set SESSION_SECRET (or add it to .dev.vars).'); process.exit(2); }
// PGlite serves one connection at a time: open and close one per query.
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
let fails = 0;
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(more).slice(0, 300)}`}`); };
const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookieOf = u => {
  const body = Buffer.from(JSON.stringify({ userId: u.id, email: u.email, role: u.role, fullName: u.full_name, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`;
};
async function call(who, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (typeof who === 'string') headers.cookie = who; else if (who) headers.cookie = cookieOf(who);
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
}
const byRole = async role => (await db(`SELECT id, email, full_name, role FROM users WHERE role = $1 AND is_active = 1 ORDER BY created_at LIMIT 1`, role))[0];
const mgmt = await byRole('management'), opsMgr = await byRole('operations_manager'), opsStaff = await byRole('operations_staff');
check('demo accounts exist', mgmt && opsMgr && opsStaff, { mgmt, opsMgr, opsStaff });

const stamp = Date.now().toString().slice(-6);
const phoneLocal = `012-77${stamp.slice(0, 1)} ${stamp.slice(1)}`;
const phoneDigits = '6' + phoneLocal.replace(/\D/g, '');
let r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Pin Tester ${stamp}`, employmentType: 'internal' });
check('ops staff adds an internal cleaner', r.status === 201, r);
const cleanerId = r.json.id;

r = await call(opsStaff, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, { phone: phoneLocal });
check('ops staff cannot give app access (403)', r.status === 403, r);
r = await call(null, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, { phone: phoneLocal });
check('signed out cannot give app access (401)', r.status === 401, r);
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, { phone: 'abc' });
check('bad phone refused (422)', r.status === 422, r);
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, { phone: phoneLocal });
check('ops manager gives app access (200) with a 6-digit PIN', r.status === 200 && /^\d{6}$/.test(r.json.pin) && r.json.phone === `+${phoneDigits}`, r);
const firstPin = r.json.pin;
const [u] = await db(`SELECT u.id, u.email, u.role, u.login_phone, u.must_change_password, c.user_id FROM cleaners c JOIN users u ON u.id = c.user_id WHERE c.id = $1`, cleanerId);
check('new cleaner login: housekeeper, phone, placeholder email, must change, linked', u && u.role === 'housekeeper' && u.login_phone === phoneDigits && u.email.endsWith('@no-email.invalid') && u.must_change_password === 1, u);
const audits = await db(`SELECT after_state FROM audit_log WHERE entity_id = $1 AND action = 'housekeeping.cleaner_app_access'`, cleanerId);
check('audited, without the PIN', audits.length === 1 && !audits[0].after_state.includes(firstPin), audits);

r = await call(opsMgr, 'GET', '/api/housekeeping/cleaners');
check('roster shows the sign-in phone', r.json.data?.find(c => c.id === cleanerId)?.loginPhone === `+${phoneDigits}`, r.json.data?.find(c => c.id === cleanerId));

const wrongPin = firstPin === '000000' ? '000001' : '000000';
r = await call(null, 'POST', '/api/auth/login-pin', { phone: phoneLocal, pin: wrongPin });
check('wrong PIN refused (401)', r.status === 401 && r.json.error?.code === 'INVALID_CREDENTIALS', r);
const ev = await db(`SELECT method, result FROM login_events WHERE user_id = $1 ORDER BY at DESC LIMIT 1`, u.id);
check('wrong PIN recorded in the sign-in log as pin', ev[0]?.method === 'pin' && ev[0]?.result === 'wrong_password', ev);
r = await call(null, 'POST', '/api/auth/login-pin', { phone: '0129999999', pin: '123456' });
check('unknown phone gets the same refusal (401)', r.status === 401 && r.json.error?.code === 'INVALID_CREDENTIALS', r);
r = await call(null, 'POST', '/api/auth/login-pin', { phone: `+${phoneDigits}`, pin: firstPin });
check('right PIN signs in (international format too)', r.status === 200 && r.json.user?.phoneSignIn === true && r.json.user?.mustChangePassword === true && r.json.home === '/change-password', r);
let field = r.cookie;

r = await call(field, 'GET', '/api/field/tasks');
check('on the first PIN, field jobs are not reachable yet (403)', r.status === 403, r);
r = await call(field, 'POST', '/api/auth/change-password', { password: 'Abcdefg1' });
check('a password is refused for a PIN account (422)', r.status === 422 && r.json.error?.fields?.password === 'Exactly 6 digits', r);
r = await call(field, 'POST', '/api/auth/change-password', { password: '123456' });
check('an easy PIN is refused (422)', r.status === 422 && r.json.error?.fields?.password === 'Too easy to guess', r);
r = await call(field, 'POST', '/api/auth/change-password', { password: '482913' });
check('own PIN saved', r.status === 200, r);
r = await call(null, 'POST', '/api/auth/login-pin', { phone: phoneLocal, pin: '482913' });
check('signs in with own PIN, nothing to change', r.status === 200 && r.json.user?.mustChangePassword === false && r.json.home === '/field/today', r);
field = r.cookie;
r = await call(field, 'GET', '/api/field/tasks');
check('field app jobs reachable (200)', r.status === 200, r);
r = await call(field, 'GET', '/api/units');
check('desk screens still refused (403)', r.status === 403, r);
r = await call(field, 'GET', '/api/auth/session');
check('session says phone sign-in', r.json.user?.phoneSignIn === true, r);
r = await call(field, 'POST', '/api/account/password', { current: '482913', password: 'Abcdefg1' });
check('My account: password refused for PIN account', r.status === 422, r);
r = await call(field, 'POST', '/api/account/password', { current: '482913', password: '305718' });
check('My account: PIN changed', r.status === 200, r);

// Office staff cannot use the PIN door.
const opsPhone = '6017' + stamp + '1';
await db(`UPDATE users SET login_phone = $1 WHERE id = $2`, opsPhone, opsStaff.id);
r = await call(null, 'POST', '/api/auth/login-pin', { phone: opsPhone, pin: '123456' });
check('office account cannot sign in by phone even with a phone set (401)', r.status === 401, r);
await db(`UPDATE users SET login_phone = NULL WHERE id = $1`, opsStaff.id);

// Lockout after 5 wrong PINs.
for (let i = 0; i < 5; i++) await call(null, 'POST', '/api/auth/login-pin', { phone: phoneLocal, pin: '999990' });
r = await call(null, 'POST', '/api/auth/login-pin', { phone: phoneLocal, pin: '305718' });
check('locked after 5 wrong PINs, even with the right one (423)', r.status === 423, r);

// New PIN: unlocks, ends sessions, back to must-change.
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, {});
check('New PIN (phone kept)', r.status === 200 && /^\d{6}$/.test(r.json.pin), r);
const secondPin = r.json.pin;
r = await call(field, 'GET', '/api/field/tasks');
check('old phone session ended (401)', r.status === 401, r);
r = await call(null, 'POST', '/api/auth/login-pin', { phone: phoneLocal, pin: secondPin });
check('new PIN works and unlocks', r.status === 200 && r.json.user?.mustChangePassword === true, r);

// Another cleaner cannot take the same number.
r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Pin Tester B ${stamp}`, employmentType: 'internal' });
const other = r.json.id;
r = await call(mgmt, 'POST', `/api/housekeeping/cleaners/${other}/access`, { phone: phoneLocal });
check('same number on a second login refused (409)', r.status === 409, r);
r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Crew ${stamp}`, employmentType: 'outsourced', vendorName: 'X Sdn Bhd' });
r = await call(mgmt, 'POST', `/api/housekeeping/cleaners/${r.json.id}/access`, { phone: '0133333333' });
check('outsourced cleaner gets no login (422)', r.status === 422, r);

// A roster entry pointing at an office account must never let an ops manager reset that account.
await db(`UPDATE cleaners SET user_id = $1 WHERE id = $2`, mgmt.id, other);
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${other}/access`, { phone: '0144444444' });
check('linked office account refused (403)', r.status === 403, r);
const [m] = await db(`SELECT login_phone FROM users WHERE id = $1`, mgmt.id);
check('management account untouched', m.login_phone === null, m);
await db(`UPDATE cleaners SET user_id = NULL WHERE id = $1`, other);

// Management's temporary password on a PIN account is a PIN.
r = await call(mgmt, 'POST', `/api/users/${u.id}/security`, { action: 'temp_password' });
check('management reset gives a 6-digit temporary PIN', r.status === 200 && /^\d{6}$/.test(r.json.tempPassword), r);
r = await call(mgmt, 'POST', `/api/users/${u.id}/resend-invite`, {});
check('re-send invite refused for a phone account (409)', r.status === 409 && r.json.error?.code === 'NO_EMAIL', r);

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
