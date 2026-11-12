// Employee ID and 6-digit PIN sign-in for field staff (PRs #364, #365), end to end: who may give app access, sign-in, first PIN,
// lockout, New PIN, no way in by phone; and Dream Crafter staff (renovators): app access, Clock only, switch off.
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
// Office people are found by department and position: the operations manager and finance admin roles are retired (0146).
const byPlace = async (dept, pos) => (await db(`SELECT u.id, u.email, u.full_name, u.role FROM users u JOIN departments d ON d.id = u.department_id
  JOIN positions p ON p.id = u.position_id WHERE d.name = $1 AND p.name = $2 AND u.is_active = 1 ORDER BY u.created_at LIMIT 1`, dept, pos))[0];
const mgmt = await byRole('management'), opsMgr = await byPlace('Operations', 'Operations Manager'), opsStaff = await byPlace('Operations', 'Operations Staff');
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
const [placed] = await db(`SELECT d.kind FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = $1`, u.id);
check('the new cleaner login is in the Cleaning department (petty cash follows it)', placed?.kind === 'cleaning', placed);
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
// Cleaners and technicians live on HR > Employees only (owner, 23 Oct 2026): not on Users and roles, and switching one off on
// HR > Employees switches their app login off with it.
r = await call(mgmt, 'GET', '/api/users');
check('Users and roles does not list the cleaner', r.status === 200 && !r.json.data?.some(x => x.id === u.id), r.json.data?.find(x => x.id === u.id));
r = await call(opsStaff, 'PATCH', `/api/housekeeping/cleaners/${cleanerId}`, { isActive: false });
const [off] = await db('SELECT is_active FROM users WHERE id = $1', u.id);
check('switching the cleaner off on HR > Employees switches their login off', r.status === 200 && off.is_active === 0, { r, off });
r = await call(opsStaff, 'PATCH', `/api/housekeeping/cleaners/${cleanerId}`, { isActive: true });
const [on] = await db('SELECT is_active FROM users WHERE id = $1', u.id);
check('...and back on, the login works again', r.status === 200 && on.is_active === 1, { r, on });
// Outside company and back: the link stays, the login is off meanwhile, and Give app access reopens the same login.
r = await call(opsStaff, 'PATCH', `/api/housekeeping/cleaners/${cleanerId}`, { employmentType: 'outsourced', vendorName: 'Some Sdn Bhd' });
const [out] = await db('SELECT c.user_id, u.is_active FROM cleaners c JOIN users u ON u.id = c.user_id WHERE c.id = $1', cleanerId);
check('moved to an outside company: same login kept, switched off', r.status === 200 && out?.user_id === u.id && out.is_active === 0, { r, out });
r = await call(opsStaff, 'PATCH', `/api/housekeeping/cleaners/${cleanerId}`, { isActive: true });
const [stillOff] = await db('SELECT is_active FROM users WHERE id = $1', u.id);
check('...switching an outside entry on does not reopen its login', r.status === 200 && stillOff.is_active === 0, { r, stillOff });
r = await call(opsStaff, 'PATCH', `/api/housekeeping/cleaners/${cleanerId}`, { employmentType: 'internal' });
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${cleanerId}/access`, {});
const [back] = await db('SELECT id, employee_id, is_active FROM users WHERE id = $1', u.id);
check('back in-house, Give app access reopens the same login and employee ID', r.status === 200 && r.json.userId === u.id && r.json.employeeId === employeeId && back.is_active === 1, { r, back });

// Dream Crafter staff (migration 0311): app access from Dream Crafter > HR > Employees, a renovator login with Clock and
// Me only, and a login that stops when the employee is switched off.
const DC_RECORD = {
  position: 'employee', nationality: null, joinDate: null, status: 'active', resignedAt: null, payBasis: 'monthly', basicSalarySen: 0, dailyRateSen: 0,
  workingDaysPerMonth: 26, workingHoursPerDay: 8, otMultiplier: 1.5, leaderAllowanceSen: 0, efficiencyAllowanceSen: 0, efficiencyThresholdPct: 100,
  paymentMethod: 'transfer', bankName: null, bankAccount: null, epfEnabled: false, socsoEnabled: false, eisEnabled: false, pcbEnabled: false,
  taxResidency: null, taxCategory: null, taxChildReliefSen: null, annualLeaveDays: null, medicalLeaveDays: null,
};
r = await call(mgmt, 'PUT', '/api/employees/dream-crafter', { ...DC_RECORD, name: `Renovation Tester ${stamp}`, phone: null });
check('management adds a Dream Crafter employee', r.status === 200 && !!r.json.data?.id, r);
const dcStaffId = r.json.data.id;
r = await call(opsMgr, 'POST', `/api/employees/dream-crafter/${dcStaffId}/access`, {});
check('an operations manager (The Conts side) cannot give a Dream Crafter employee app access (403)', r.status === 403, r);
r = await call(null, 'POST', `/api/employees/dream-crafter/${dcStaffId}/access`, {});
check('signed out cannot give a Dream Crafter employee app access (401)', r.status === 401, r);
r = await call(mgmt, 'POST', `/api/employees/dream-crafter/${dcStaffId}/access`, {});
check('management gives a Dream Crafter employee app access: an EMP- ID and a 6-digit PIN', r.status === 200 && /^EMP-\d{3,}$/.test(r.json.employeeId) && /^\d{6}$/.test(r.json.pin), r);
const { employeeId: renovatorEmployeeId, pin: renovatorFirstPin } = r.json;
const [renovatorLogin] = await db(`SELECT u.id, u.role, u.employee_id, d.kind, d.side FROM dc_staff s JOIN users u ON u.id = s.user_id
  JOIN departments d ON d.id = u.department_id WHERE s.id = $1`, dcStaffId);
check('the login is a renovator in the Renovation crew department, on the Dream Crafter side',
  renovatorLogin?.role === 'renovator' && renovatorLogin.employee_id === renovatorEmployeeId && renovatorLogin.kind === 'renovation' && renovatorLogin.side === 'dream_crafter', renovatorLogin);
r = await call(mgmt, 'GET', '/api/employees/dream-crafter');
check('Employee Master shows the employee ID and that app access is set up', r.json?.hasAppAccess === true && r.json.data?.find(p => p.id === dcStaffId)?.employeeId === renovatorEmployeeId, r.json?.data?.find(p => p.id === dcStaffId));

r = await call(null, 'POST', '/api/auth/login-pin', { employeeId: renovatorEmployeeId, pin: renovatorFirstPin });
check('the renovator signs in with the first PIN and must choose their own', r.status === 200 && r.json.user?.role === 'renovator' && r.json.user?.mustChangePassword === true && r.json.home === '/change-password', r);
let renovator = r.cookie;
r = await call(renovator, 'POST', '/api/auth/change-password', { password: '482913' });
check('the renovator chooses their own PIN', r.status === 200, r);
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId: renovatorEmployeeId, pin: '482913' });
check('signs in again, landing on the Clock', r.status === 200 && r.json.user?.mustChangePassword === false && r.json.home === '/portal/clock', r);
renovator = r.cookie;

for (const [method, path] of [['GET', '/api/auth/session'], ['GET', '/api/account'], ['GET', '/api/notifications'], ['GET', '/api/field/clock']]) {
  r = await call(renovator, method, path);
  check(`a renovator reaches ${method} ${path}`, r.status === 200, r);
}
for (const [method, path] of [
  ['GET', '/api/field/tasks'], ['GET', '/api/field/repairs'], ['GET', '/api/field/units'], ['GET', '/api/field/pay'], ['GET', '/api/field/leave'], ['POST', '/api/field/leave'],
  ['GET', '/api/claims/summary'], ['POST', '/api/claims/receipts'], ['GET', '/api/documents/no-such-file/download'], ['GET', '/api/audit'], ['POST', '/api/maintenance/issues'],
  ['GET', '/api/units'], ['GET', '/api/attendance'], ['GET', '/api/attendance/dream-crafter'], ['GET', '/api/employees/dream-crafter'],
]) {
  r = await call(renovator, method, path, method === 'GET' ? undefined : {});
  check(`a renovator is refused ${method} ${path} (403)`, r.status === 403, r);
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const punch = async (action) => {
  const form = new FormData();
  form.append('action', action); form.append('lat', '3.139'); form.append('lng', '101.687'); form.append('accuracy', '20');
  form.append('photo', new Blob([png], { type: 'image/png' }), 'selfie.png');
  const res = await fetch(BASE + '/api/field/clock', { method: 'POST', headers: { cookie: renovator }, body: form });
  return { status: res.status, json: await res.json().catch(() => null) };
};
r = await call(renovator, 'GET', '/api/field/clock');
check('the Clock screen knows them by name and employee ID', r.json?.name === `Renovation Tester ${stamp}` && r.json.employeeId === renovatorEmployeeId, r);
r = await punch('in');
check('the renovator clocks in with a selfie and a location', r.status === 201 && !!r.json?.data?.id, r);
const renovatorPunchId = r.json.data.id;
r = await punch('out');
check('...and clocks out', r.status === 200 && !!r.json?.data?.clockOutAt, r);
r = await call(mgmt, 'GET', '/api/attendance/dream-crafter');
const renovatorLine = r.json?.data?.find(l => l.employee.dcStaffId === dcStaffId);
check('Dream Crafter Attendance lists the punch, with no building to compare', r.status === 200 && renovatorLine?.punch?.id === renovatorPunchId && renovatorLine.inPlace === null, r);
r = await call(mgmt, 'GET', '/api/attendance');
check('The Conts\' Attendance does not list the Dream Crafter employee', r.status === 200 && !r.json?.data?.some(l => l.punch?.id === renovatorPunchId || l.employee.name === `Renovation Tester ${stamp}`), r.json?.data?.length);
r = await call(opsMgr, 'GET', '/api/attendance/dream-crafter');
check('an operations manager (The Conts side) cannot read Dream Crafter Attendance (403)', r.status === 403, r);
r = await call(mgmt, 'POST', '/api/attendance/dream-crafter', { dcStaffId, date: '2026-01-05', clockIn: '08:30', clockOut: '17:30', note: 'Forgot to clock in' });
check('management keys a day for a Dream Crafter employee', r.status === 201 && r.json?.data?.edited === true, r);
r = await call(mgmt, 'POST', '/api/attendance/dream-crafter', { dcStaffId, date: '2026-01-05', clockIn: '08:00', clockOut: '17:30', note: 'Came in earlier' });
check('...and the same day again fixes its times', r.status === 200 && r.json?.data?.edited === true, r);
r = await call(mgmt, 'POST', '/api/attendance/dream-crafter', { dcStaffId: 'no-such-person', date: '2026-01-05', clockIn: '08:30', clockOut: null, note: 'Test' });
check('a person who is not Dream Crafter staff is refused (404)', r.status === 404, r);
r = await call(mgmt, 'GET', '/api/users');
check('Users and roles does not list the renovator', r.status === 200 && !r.json.data?.some(x => x.id === renovatorLogin.id), r.json.data?.find(x => x.id === renovatorLogin.id));
r = await call(mgmt, 'PATCH', `/api/users/${renovatorLogin.id}`, { fullName: 'Renamed Here' });
check('a renovator account cannot be changed under Users (422)', r.status === 422, r);

r = await call(mgmt, 'PUT', '/api/employees/dream-crafter', { ...DC_RECORD, id: dcStaffId, name: `Renovation Tester ${stamp}`, phone: null, isActive: false });
const [renovatorOff] = await db('SELECT is_active FROM users WHERE id = $1', renovatorLogin.id);
check('switching the Dream Crafter employee off switches their login off', r.status === 200 && r.json.data?.isActive === false && renovatorOff.is_active === 0, { r, renovatorOff });
r = await call(renovator, 'GET', '/api/field/clock');
check('...and ends their session at once (401)', r.status === 401, r);
r = await call(null, 'POST', '/api/auth/login-pin', { employeeId: renovatorEmployeeId, pin: '482913' });
check('...and blocks sign-in', r.status !== 200, r);
r = await call(mgmt, 'GET', '/api/attendance/dream-crafter?date=2026-01-06');
check('a switched-off employee who did not punch is off that day\'s Attendance', r.status === 200 && !r.json?.data?.some(l => l.employee.dcStaffId === dcStaffId), r);
r = await call(mgmt, 'PUT', '/api/employees/dream-crafter', { ...DC_RECORD, id: dcStaffId, name: `Renovation Tester ${stamp}`, phone: null, isActive: true });
const [renovatorOn] = await db('SELECT is_active FROM users WHERE id = $1', renovatorLogin.id);
check('...and switching them back on reopens the login', r.status === 200 && renovatorOn.is_active === 1, { r, renovatorOn });

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
