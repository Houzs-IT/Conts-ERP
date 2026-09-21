import { createHmac } from 'node:crypto';
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const USERS = { management: ['11111111-1111-4111-8111-000000000002','management@theconts.com','Lee Wei Siang'], housekeeper: ['11111111-1111-4111-8111-000000000005','nurul@theconts.com','Nurul Huda'], finance_admin: ['11111111-1111-4111-8111-000000000003','finance@theconts.com','Priya Devi'], operations_manager: ['11111111-1111-4111-8111-000000000001','aina@theconts.com','Aina Zulkifli'] };
const cookieFor = (role) => { const [id, email, name] = USERS[role]; const body = Buffer.from(JSON.stringify({ userId: id, email, role, fullName: name, exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, ''); return `tc_session=${body}.${b64(createHmac('sha256', 'smoke-test-secret-not-real-0123456789').update(body).digest())}`; };
export async function call(method, path, body, role = 'management') {
  const r = await fetch('http://localhost:8788' + path, { method, headers: { cookie: cookieFor(role), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
let fails = 0;
export function check(name, cond, extra = '') { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' :: ' + String(extra).slice(0, 400)}`); }
export const done = () => { console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0); };
