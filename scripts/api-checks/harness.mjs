// The session middleware reads each user's role and active flag from the database, so every session here
// belongs to a seeded user (seed.sql); a signed cookie for an id that is not in users is refused (401).
// Each check file expects a freshly reset database and a local server (npm run dev on :8788, SESSION_SECRET=smoke-test-secret-not-real-0123456789).
import { createHmac } from 'node:crypto';
// SESSION_SECRET from the environment runs these against a server using a real .dev.vars secret (e.g. one reading staging).
const SECRET = process.env.SESSION_SECRET ?? 'smoke-test-secret-not-real-0123456789';
// API_BASE points the checks at a server on another port (e.g. http://localhost:8795).
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const USERS = { management: ['11111111-1111-4111-8111-000000000002','management@theconts.com','Test Bot (management)'], housekeeper: ['11111111-1111-4111-8111-000000000005','nurul@theconts.com','Nurul Huda'], finance_admin: ['11111111-1111-4111-8111-000000000003','finance@theconts.com','Priya Devi'], operations_manager: ['11111111-1111-4111-8111-000000000001','aina@theconts.com','Aina Zulkifli'], operations_staff: ['11111111-1111-4111-8111-000000000004','weiwen@theconts.com','Chan Wei Wen'], technician: ['11111111-1111-4111-8111-000000000006','hafiz@theconts.com','Hafiz Rahman'] };
export const cookieFor = (role) => { const [id, email, name] = USERS[role]; const body = Buffer.from(JSON.stringify({ userId: id, email, role, fullName: name, exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, ''); return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`; };
export async function call(method, path, body, role = 'management') {
  const r = await fetch(BASE + path, { method, headers: { cookie: cookieFor(role), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
/** Like call(), but as any session, e.g. an owner: { userId, email, role, fullName, iat? }. */
export async function callAsUser(u, method, path, body) {
  const b = Buffer.from(JSON.stringify({ userId: u.userId, email: u.email, role: u.role, fullName: u.fullName ?? 'Test', iat: u.iat, exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  const cookie = `tc_session=${b}.${b64(createHmac('sha256', SECRET).update(b).digest())}`;
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
let fails = 0;
export function check(name, cond, extra = '') { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' :: ' + String(extra).slice(0, 400)}`); }
export const done = () => { console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0); };
