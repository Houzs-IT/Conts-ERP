// Employee ID and 6-digit PIN sign-in for field staff (PRs #364, #365), end to end: who may give app access, sign-in, first PIN,
// lockout, New PIN, no way in by phone.
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
await db(`INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, is_active, created_at, updated_at)
  VALUES ('test-ops-staff', 'opsstaff@local.test', 'Ops Staff Test', 'x', 'operations_staff', 0, 1, now()::text, now()::text) ON CONFLICT DO NOTHING`);
const byRole = async role => (await db(`SELECT id, email, full_name, role FROM users WHERE role = $1 AND is_active = 1 ORDER BY created_at LIMIT 1`, role))[0];
const mgmt = await byRole('management'), opsMgr = await byRole('operations_manager'), opsStaff = await byRole('operations_staff');
check('demo accounts exist', mgmt && opsMgr && opsStaff, { mgmt, opsMgr, opsStaff });

const stamp = Date.now().toString().slice(-6);
let r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Pin Tester ${stamp}`, employmentType: 'internal', phone: '+60 12-345 6789' });
check('ops staff adds an internal cleaner', r.status === 201, r);
const cleanerId = r.json.id;

r = await call(opsStaff, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, {});
check('ops staff cannot give app access (403)', r.status === 403, r);
r = await call(null, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, {});
check('signed out cannot give app access (401)', r.status === 401, r);
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, {});
check('ops manager gives app access: an EMP- ID and a 6-digit PIN', r.status === 200 && /^EMP-\d{3,}$/.test(r.json.employeeId) && /^\d{6}$/.test(r.json.pin), r);
const { employeeId, pin: firstPin } = r.json;
const number = employeeId.slice(4);
const [u] = await db(`SELECT u.id, u.email, u.role, u.employee_id, u.must_change_password, u.phone FROM cleaners c JOIN users u ON u.id = c.user_id WHERE c.id = $1`, cleanerId);
check('new cleaner login: housekeeper, employee ID, placeholder email, must change, phone kept as contact', u && u.role === 'housekeeper' && u.employee_id === employeeId && u.email.endsWith('@no-email.invalid') && u.must_change_password === 1 && u.phone === '+60 12-345 6789', u);
const audits = await db(`SELECT after_state FROM audit_log WHERE entity_id = $1 AND action = 'housekeeping.cleaner_app_access'`, cleanerId);
check('audited, without the PIN', audits.length === 1 && !audits[0].after_state.includes(firstPin), audits);

r = await call(opsMgr, 'GET', '/api/housekeeping/cleaners');
check('roster shows the employee ID', r.json.data?.find(c => c.id === cleanerId)?.employeeId === employeeId, r.json.data?.find(c => c.id === cleanerId));

const wrongPin = firstPin === '000000' ? '000001' : '000000';
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId, pin: wrongPin });
check('wrong PIN refused (401)', r.status === 401 && r.json.error?.code === 'INVALID_CREDENTIALS', r);
const ev = await db(`SELECT method, result FROM login_events WHERE user_id = $1 ORDER BY at DESC LIMIT 1`, u.id);
check('wrong PIN recorded in the sign-in log as pin', ev[0]?.method === 'pin' && ev[0]?.result === 'wrong_password', ev);
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId: 'EMP-99999', pin: '123456' });
check('unknown ID gets the same refusal (401)', r.status === 401 && r.json.error?.code === 'INVALID_CREDENTIALS', r);
r = await call(null, 'POST', '/api/auth/login-pin', { phone: '+60 12-345 6789', pin: firstPin });
check('a phone number is not a way in (422)', r.status === 422, r);
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId: `emp ${Number(number)}`, pin: firstPin });
check('right PIN signs in, ID typed loosely ("emp 7")', r.status === 200 && r.json.user?.employeeId === employeeId && r.json.user?.mustChangePassword === true && r.json.home === '/change-password', r);
let field = r.cookie;

r = await call(field, 'GET', '/api/field/tasks');
check('on the first PIN, field jobs are not reachable yet (403)', r.status === 403, r);
r = await call(field, 'POST', '/api/auth/change-password', { password: 'Abcdefg1' });
check('a password is refused for a PIN account (422)', r.status === 422 && r.json.error?.fields?.password === 'Exactly 6 digits', r);
r = await call(field, 'POST', '/api/auth/change-password', { password: '123456' });
check('an easy PIN is refused (422)', r.status === 422 && r.json.error?.fields?.password === 'Too easy to guess', r);
r = await call(field, 'POST', '/api/auth/change-password', { password: '482913' });
check('own PIN saved', r.status === 200, r);
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId: number, pin: '482913' });
check('signs in with own PIN by the number alone, nothing to change', r.status === 200 && r.json.user?.mustChangePassword === false && r.json.home === '/portal/today', r);
field = r.cookie;
r = await call(field, 'GET', '/api/field/tasks');
check('field app jobs reachable (200)', r.status === 200, r);
r = await call(field, 'GET', '/api/units');
check('desk screens still refused (403)', r.status === 403, r);
r = await call(field, 'GET', '/api/auth/session');
check('session carries the employee ID', r.json.user?.employeeId === employeeId, r);
r = await call(field, 'POST', '/api/account/password', { current: '482913', password: 'Abcdefg1' });
check('My account: password refused for PIN account', r.status === 422, r);
r = await call(field, 'POST', '/api/account/password', { current: '482913', password: '305718' });
check('My account: PIN changed', r.status === 200, r);

// Office staff cannot use the PIN door, even with an employee ID on their row.
await db(`UPDATE users SET employee_id = 'EMP-9999' WHERE id = $1`, opsStaff.id);
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId: 'EMP-9999', pin: '123456' });
check('office account cannot sign in by employee ID (401)', r.status === 401, r);
await db(`UPDATE users SET employee_id = NULL WHERE id = $1`, opsStaff.id);

// Lockout after 5 wrong PINs.
for (let i = 0; i < 5; i++) await call(null, 'POST', '/api/auth/login-pin', { employeeId, pin: '999990' });
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId, pin: '305718' });
check('locked after 5 wrong PINs, even with the right one (423)', r.status === 423, r);

// New PIN: same ID, unlocks, ends sessions, back to must-change.
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, {});
check('New PIN keeps the same employee ID', r.status === 200 && r.json.employeeId === employeeId && /^\d{6}$/.test(r.json.pin), r);
const secondPin = r.json.pin;
r = await call(field, 'GET', '/api/field/tasks');
check('old session ended (401)', r.status === 401, r);
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId, pin: secondPin });
check('new PIN works and unlocks', r.status === 200 && r.json.user?.mustChangePassword === true, r);

// The next person gets the next number.
r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Pin Tester B ${stamp}`, employmentType: 'internal' });
const other = r.json.id;
r = await call(mgmt, 'POST', `/api/housekeeping/cleaners/${other}/access`, {});
check('next cleaner gets a different, higher ID', r.status === 200 && Number(r.json.employeeId.slice(4)) > Number(number), r);
r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Crew ${stamp}`, employmentType: 'outsourced', vendorName: 'X Sdn Bhd' });
r = await call(mgmt, 'POST', `/api/housekeeping/cleaners/${r.json.id}/access`, {});
check('outsourced cleaner gets no login (422)', r.status === 422, r);

// A roster entry pointing at an office account must never let an ops manager reset that account.
r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Pin Tester C ${stamp}`, employmentType: 'internal' });
const linked = r.json.id;
await db(`UPDATE cleaners SET user_id = $1 WHERE id = $2`, mgmt.id, linked);
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${linked}/access`, {});
check('linked office account refused (403)', r.status === 403, r);
const [m] = await db(`SELECT employee_id FROM users WHERE id = $1`, mgmt.id);
check('management account untouched', m.employee_id === null, m);
await db(`UPDATE cleaners SET user_id = NULL WHERE id = $1`, linked);

// Management's temporary password on a PIN account is a PIN.
r = await call(mgmt, 'POST', `/api/users/${u.id}/security`, { action: 'temp_password' });
check('management reset gives a 6-digit temporary PIN', r.status === 200 && /^\d{6}$/.test(r.json.tempPassword), r);
r = await call(mgmt, 'POST', `/api/users/${u.id}/resend-invite`, {});
check('re-send invite refused for an account with no email (409)', r.status === 409 && r.json.error?.code === 'NO_EMAIL', r);
r = await call(mgmt, 'GET', '/api/users');
check('Users and roles lists the employee ID', r.json.data?.find(x => x.id === u.id)?.employeeId === employeeId, r.json.data?.find(x => x.id === u.id));

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
