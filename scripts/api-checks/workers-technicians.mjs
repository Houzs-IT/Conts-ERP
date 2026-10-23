// Workers > Technicians (PR #365), end to end: the list, app access, jobs linked to the entry and reaching the phone app.
//
// Run on a throwaway database only (it adds accounts, cleaners, technicians and jobs):
//   node scripts/dev-pglite.mjs   (leave running), a local server on it (wrangler pages dev dist with
//   CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE pointing at it), then
//   API_BASE=http://localhost:8788 DB_URL=postgres://pos_app:local@127.0.0.1:55441/postgres node scripts/api-checks/workers-technicians.mjs
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
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(more).slice(0, 400)}`}`); };
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
const mgmt = await byRole('management'), opsMgr = await byRole('operations_manager'), opsStaff = await byRole('operations_staff'), finance = await byRole('finance_admin');
const HAFIZ = '11111111-1111-4111-8111-000000000006';
const [unit0] = await db(`SELECT id FROM units ORDER BY id LIMIT 1`);
// A fresh job with no owner approval: one waiting for the owner is kept out of the phone app on purpose.
const job = { id: (await call(opsMgr, 'POST', '/api/maintenance/issues', { unitId: unit0.id, title: `Door ${Date.now()}`, category: 'furniture' })).json.id };
check('fresh job made', !!job.id, job);

let r = await call(opsMgr, 'GET', '/api/maintenance/technicians');
const hafiz = r.json.data?.find(t => t.userId === HAFIZ);
check('picker: list entries with id, kind and login', r.status === 200 && hafiz?.kind === 'in_house' && hafiz.id && r.json.data.some(t => t.kind === 'contractor' && t.name === 'Ah Seng Plumbing'), r.json);
r = await call(opsMgr, 'GET', '/api/maintenance/technicians?all=1');
check('whole list: office link shows its role', r.status === 200 && r.json.data.some(t => t.name === 'Aina Zulkifli' && t.loginRole === 'operations_manager'), r.json);
r = await call(opsMgr, 'GET', '/api/maintenance/technicians?logins=1');
check('linkable logins: field and operations only', r.status === 200 && r.json.data.every(u => ['technician', 'housekeeper', 'operations_staff', 'operations_manager'].includes(u.role)) && r.json.data.some(u => u.id === HAFIZ), r.json);
r = await call(finance, 'GET', '/api/maintenance/technicians?all=1');
check('finance cannot open the list (403)', r.status === 403, r);

const stamp = Date.now().toString().slice(-5);
const faizName = `Faiz Test ${stamp}`;
r = await call(opsStaff, 'POST', '/api/maintenance/technicians', { name: faizName, employmentType: 'internal' });
check('ops staff adds an in-house technician', r.status === 201, r);
const faizId = r.json.id;
r = await call(opsStaff, 'POST', '/api/maintenance/technicians', { name: faizName.toUpperCase(), employmentType: 'outsourced' });
check('same name again refused (409)', r.status === 409, r);
r = await call(opsStaff, 'POST', '/api/maintenance/technicians', { name: `Kim Aircon ${stamp}`, employmentType: 'outsourced', vendorName: 'Kim Aircon Sdn Bhd', phone: '+60 12-111 2222' });
check('ops staff adds a contractor', r.status === 201, r);
const kimId = r.json.id;

r = await call(opsStaff, 'POST', `/api/maintenance/technicians/${faizId}/access`, { phone: `0168${stamp}11` });
check('ops staff cannot give app access (403)', r.status === 403, r);
r = await call(opsMgr, 'POST', `/api/maintenance/technicians/${kimId}/access`, { phone: '0123334444' });
check('contractor gets no login (422)', r.status === 422, r);
const aina = (await call(opsMgr, 'GET', '/api/maintenance/technicians?all=1')).json.data.find(t => t.name === 'Aina Zulkifli');
r = await call(mgmt, 'POST', `/api/maintenance/technicians/${aina.id}/access`, { phone: '0125556666' });
check('office login never gets a PIN (403)', r.status === 403, r);
r = await call(opsMgr, 'POST', `/api/maintenance/technicians/${faizId}/access`, { phone: `0168${stamp}11` });
check('ops manager gives a technician app access', r.status === 200 && /^\d{6}$/.test(r.json.pin), r);
const pin = r.json.pin;
const [faizUser] = await db(`SELECT u.id, u.role, u.login_phone FROM technicians t JOIN users u ON u.id = t.user_id WHERE t.id = $1`, faizId);
check('new login is a technician with phone sign-in', faizUser?.role === 'technician' && !!faizUser.login_phone, faizUser);

r = await call(null, 'POST', '/api/auth/login-pin', { phone: `0168${stamp}11`, pin });
let field = r.cookie;
check('technician signs in with phone and PIN', r.status === 200 && r.json.user?.role === 'technician', r);
r = await call(field, 'POST', '/api/auth/change-password', { password: '804219' });
check('technician chooses own PIN', r.status === 200, r);

r = await call(opsMgr, 'PATCH', `/api/maintenance/issues/${job.id}`, { assigneeName: `  ${faizName.toLowerCase()} ` });
check('job given to the list entry (any case)', r.status === 200, r);
let [m] = await db(`SELECT vendor_name, assignee_kind, assignee_user_id, technician_id FROM maintenance_issues WHERE id = $1`, job.id);
check('job: list name, in-house, login and entry linked', m.vendor_name === faizName && m.assignee_kind === 'in_house' && m.assignee_user_id === faizUser.id && m.technician_id === faizId, m);
r = await call(field, 'GET', '/api/field/repairs');
check('job shows in the technician\'s phone app', r.status === 200 && r.json.mine?.some(j => j.id === job.id), r.json);

r = await call(opsMgr, 'PATCH', '/api/maintenance/technicians/' + faizId, { name: `Faiz Ahmad ${stamp}` });
check('rename', r.status === 200, r);
[m] = await db(`SELECT vendor_name FROM maintenance_issues WHERE id = $1`, job.id);
check('open job shows the new name', m.vendor_name === `Faiz Ahmad ${stamp}`, m);
r = await call(field, 'GET', '/api/field/repairs');
check('still in the phone app after the rename', r.json.mine?.some(j => j.id === job.id), r.json);

r = await call(opsMgr, 'PATCH', `/api/maintenance/issues/${job.id}`, { assigneeName: `Brand New Fixers ${stamp}` });
[m] = await db(`SELECT m.assignee_kind, m.assignee_user_id, t.full_name, t.employment_type FROM maintenance_issues m JOIN technicians t ON t.id = m.technician_id WHERE m.id = $1`, job.id);
check('a typed new name becomes a contractor on the list', r.status === 200 && m?.employment_type === 'outsourced' && m.assignee_kind === 'contractor' && m.assignee_user_id === null && m.full_name === `Brand New Fixers ${stamp}`, { r, m });
r = await call(field, 'GET', '/api/field/repairs');
check('job left the technician\'s phone app', !r.json.mine?.some(j => j.id === job.id), r.json);

r = await call(opsMgr, 'PATCH', '/api/maintenance/technicians/' + kimId, { isActive: false });
check('contractor switched off', r.status === 200, r);
r = await call(opsMgr, 'PATCH', `/api/maintenance/issues/${job.id}`, { assigneeName: `Kim Aircon ${stamp}` });
check('a switched-off name is refused, not reused (422)', r.status === 422 && /switched off/.test(r.json.error?.message ?? ''), r);
r = await call(opsMgr, 'GET', '/api/maintenance/technicians');
check('switched-off contractor not in the picker', !r.json.data.some(t => t.id === kimId), r.json);

const [unit] = await db(`SELECT id FROM units ORDER BY id LIMIT 1`);
r = await call(opsMgr, 'POST', '/api/maintenance/issues', { unitId: unit.id, title: `Leak ${stamp}`, category: 'plumbing', assigneeName: 'Hafiz Rahman' });
const newJob = r.json?.id;
[m] = newJob ? await db(`SELECT technician_id, assignee_user_id FROM maintenance_issues WHERE id = $1`, newJob) : [null];
check('a new job is linked to the list entry and login', r.status === 201 && m?.technician_id === hafiz.id && m.assignee_user_id === HAFIZ, { r, m });

// Cleaners use the same shared code: still works.
r = await call(opsStaff, 'POST', '/api/housekeeping/cleaners', { name: `Cleaner ${stamp}`, employmentType: 'internal' });
r = await call(opsMgr, 'POST', `/api/housekeeping/cleaners/${r.json.id}/access`, { phone: `0179${stamp}22` });
check('cleaner app access still works', r.status === 200 && /^\d{6}$/.test(r.json.pin), r);

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
