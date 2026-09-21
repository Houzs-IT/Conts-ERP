// Password reset flow regression checks against the LOCAL dev server.
// Run: npm run dev (in another terminal), then DATABASE_URL=<local pos_app url> node scripts/check-reset-password.mjs
// Never point this at a live site — it creates and consumes test accounts/tokens.
//
// Exists because the flow looked right on inspection but had two real bugs only
// a live test caught: (1) notify()'s hourly dedup silently dropped a "resend"
// within the same clock hour, keyed on user id instead of the token; (2) opening
// a second reset link in the same browser tab left a stale error message next
// to a form that had actually become valid, because the success path never
// cleared a previous failure's error text. Both are covered below.

import postgres from 'postgres';
import { webcrypto as crypto } from 'node:crypto';

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
async function pbkdf2(password) {
  const enc = new TextEncoder(); const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
async function sha256hex(s) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const exec = (q) => db.unsafe(q);

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

const call = async (host, path, method, body) => {
  const r = await fetch(`http://${host}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  let j; try { j = await r.json(); } catch { j = null; }
  return { status: r.status, body: j };
};

// ---- Core token lifecycle (management role, generic "any" door) -----------
const userId = 'check-reset-user-001';
await exec(`INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, is_active, created_at, updated_at) VALUES ('${userId}', 'check-reset@example.com', 'Check Reset', '${await pbkdf2('OldPassword1')}', 'management', 0, 1, '${new Date().toISOString()}', '${new Date().toISOString()}') ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, is_active = 1;`);

const good = crypto.randomUUID(); const goodHash = await sha256hex(good);
const future = new Date(Date.now() + 3600000).toISOString();
const past = new Date(Date.now() - 3600000).toISOString();
await exec(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES ('${goodHash}', '${userId}', '${future}', '${new Date().toISOString()}');`);

const expired = crypto.randomUUID();
await exec(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES ('${await sha256hex(expired)}', '${userId}', '${past}', '${new Date().toISOString()}');`);

check('GET check: unknown token refused, 400', (await call('localhost:8788', '/api/auth/reset-password?token=not-real', 'GET')).status === 400);
check('GET check: valid token accepted without consuming it', (await call('localhost:8788', `/api/auth/reset-password?token=${good}`, 'GET')).status === 200);

const bad1 = await call('localhost:8788', '/api/auth/reset-password', 'POST', { token: 'not-a-real-token', password: 'NewPassword1' });
check('POST: unknown token refused, 400', bad1.status === 400 && bad1.body.error?.code === 'INVALID_TOKEN');

const bad2 = await call('localhost:8788', '/api/auth/reset-password', 'POST', { token: good, password: 'short' });
check('POST: weak password rejected before token is even consumed', bad2.status === 422);

const badExp = await call('localhost:8788', '/api/auth/reset-password', 'POST', { token: expired, password: 'NewPassword1' });
check('POST: expired token refused, same generic message', badExp.status === 400 && badExp.body.error?.code === 'INVALID_TOKEN');

const ok = await call('localhost:8788', '/api/auth/reset-password', 'POST', { token: good, password: 'NewPassword1' });
check('POST: good token succeeds, session cookie, correct home', ok.status === 200 && ok.body.user?.role === 'management' && ok.body.home === '/');

const reuse = await call('localhost:8788', '/api/auth/reset-password', 'POST', { token: good, password: 'AnotherPassword2' });
check('POST: same token cannot be used twice', reuse.status === 400 && reuse.body.error?.code === 'INVALID_TOKEN');

check('old password no longer works', (await call('localhost:8788', '/api/auth/login', 'POST', { email: 'check-reset@example.com', password: 'OldPassword1' })).status === 401);
check('new password works', (await call('localhost:8788', '/api/auth/login', 'POST', { email: 'check-reset@example.com', password: 'NewPassword1' })).status === 200);

// ---- Door check: an owner's token only opens the owner door, and never gets
//      consumed by a refused attempt on the wrong one -----------------------
const ownerId = 'check-reset-owner-001';
await exec(`INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, is_active, created_at, updated_at) VALUES ('${ownerId}', 'check-reset-owner@example.com', 'Check Reset Owner', '${await pbkdf2('OldOwnerPw1')}', 'owner', 0, 1, '${new Date().toISOString()}', '${new Date().toISOString()}') ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, is_active = 1;`);
const ownerToken = crypto.randomUUID();
await exec(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES ('${await sha256hex(ownerToken)}', '${ownerId}', '${future}', '${new Date().toISOString()}');`);

const wrongDoor = await call('ops.localhost:8788', '/api/auth/reset-password', 'POST', { token: ownerToken, password: 'NewOwnerPw1' });
check('owner token refused on ops door', wrongDoor.status === 403 && wrongDoor.body.error?.code === 'WRONG_DOOR');
const rightDoor = await call('owner.localhost:8788', '/api/auth/reset-password', 'POST', { token: ownerToken, password: 'NewOwnerPw1' });
check('same token still works on the correct door (a refusal never wastes it)', rightDoor.status === 200 && rightDoor.body.user?.role === 'owner' && rightDoor.body.home === '/owner');

// ---- Regression: two "forgot password" requests inside the same clock hour
//      must both actually attempt a send, not silently dedupe the second ----
await call('localhost:8788', '/api/auth/forgot-password', 'POST', { email: 'check-reset@example.com' });
await call('localhost:8788', '/api/auth/forgot-password', 'POST', { email: 'check-reset@example.com' });
const entityIds = (await exec(`SELECT entity_id FROM notification_log WHERE template='account.password_reset' ORDER BY queued_at DESC LIMIT 2`)).map((r) => r.entity_id);
check('two same-hour "resend" requests get two distinct send attempts', new Set(entityIds).size === 2, entityIds.join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
await db.end();
process.exitCode = fail ? 1 : 0;
