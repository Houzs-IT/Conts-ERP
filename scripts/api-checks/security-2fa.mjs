// Two-step sign-in, the sign-in record and session revocation (migration 0098; functions/api/auth/login*.ts,
// functions/api/account/[[path]].ts, functions/api/users/sign-ins.ts).
// Needs a server with TOTP_ENC_KEY set in .dev.vars. Run: API_BASE=http://localhost:8795 SESSION_SECRET=... node scripts/api-checks/security-2fa.mjs
import { createHmac } from 'node:crypto';
import { call, callAsUser, check, done } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32decode = (s) => { let bits = 0, v = 0; const out = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, step) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', b32decode(secret)).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};
const stepNow = () => Math.floor(Date.now() / 30000);
/** A raw call with no cookie (sign-in) or a given one; returns the session cookie it was handed, if any. */
async function raw(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'user-agent': 'security-2fa-check', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  const set = r.headers.get('set-cookie')?.match(/tc_session=([^;]*)/)?.[1];
  return { status: r.status, json: j, text: t, cookie: set ? `tc_session=${set}` : null };
}

const tag = Date.now();
const email = `twostep${tag}@example.com`;
let r = await call('POST', '/api/users', { fullName: 'Two Step Check', email, role: 'operations_staff' });
check('invite target user', r.status === 201, r.text);
const uid = r.json?.id;
const me = (iat = Date.now()) => ({ userId: uid, email, role: 'operations_staff', fullName: 'Two Step Check', iat });

r = await call('POST', `/api/users/${uid}/security`, { action: 'temp_password' });
const temp = r.json?.tempPassword;
const password = 'Checked-Pass-42';
r = await callAsUser(me(), 'POST', '/api/account/password', { current: 'wrong', password });
check('change password refuses a wrong current password 422', r.status === 422, r.text);
r = await callAsUser(me(), 'POST', '/api/account/password', { current: temp, password });
check('change password from My account 200', r.status === 200, r.text);

r = await raw('POST', '/api/auth/login', { email, password });
check('password-only sign-in still works before two-step is on', r.status === 200 && !!r.cookie && !r.json.twoStep, r.text);

/* ---------------- enrol ---------------- */
r = await callAsUser(me(), 'GET', '/api/account');
check('My account says two-step is off and available', r.status === 200 && r.json.twoStep.enabled === false && r.json.twoStep.available === true, r.text);
r = await callAsUser(me(), 'POST', '/api/account/2fa/setup');
const secret = r.json?.secret;
check('setup returns a secret and an otpauth address', r.status === 200 && /^[A-Z2-7]{32}$/.test(secret ?? '') && r.json.uri.startsWith('otpauth://totp/Conts%20ERP%3A') && r.json.uri.includes(`secret=${secret}`), r.text);
r = await callAsUser(me(), 'POST', '/api/account/2fa/confirm', { code: '000000' === totp(secret, stepNow()) ? '111111' : '000000' });
check('confirm with a wrong code 422', r.status === 422, r.text);
const enrolStep = stepNow();
r = await callAsUser(me(), 'POST', '/api/account/2fa/confirm', { code: totp(secret, enrolStep) });
const backups = r.json?.backupCodes ?? [];
check('confirm turns it on and returns 10 backup codes once', r.status === 200 && backups.length === 10 && new Set(backups).size === 10, r.text);
r = await callAsUser(me(), 'GET', '/api/account');
check('My account says on, 10 backup codes left', r.json?.twoStep?.enabled === true && r.json.twoStep.backupCodesLeft === 10, r.text);
r = await call('GET', '/api/users');
check('Users list marks the account as two-step on', r.json.data.find(u => u.id === uid)?.twoStep === true);

/* ---------------- sign in with a code ---------------- */
r = await raw('POST', '/api/auth/login', { email, password });
const challenge = r.json?.challenge;
check('password step answers with a challenge and no session cookie', r.status === 200 && r.json.twoStep === true && !!challenge && !r.cookie, r.text);
r = await raw('GET', '/api/auth/session', undefined, `tc_session=${challenge}`);
check('the challenge is not accepted as a session 401', r.status === 401, r.text);
r = await raw('POST', '/api/auth/login-2fa', { challenge: challenge.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), code: totp(secret, stepNow()) });
check('a tampered challenge is refused 401', r.status === 401 && r.json.error.code === 'CHALLENGE_EXPIRED', r.text);
r = await raw('POST', '/api/auth/login-2fa', { challenge, code: totp(secret, enrolStep) });
check('the code already used at setup cannot be replayed 401', r.status === 401 && r.json.error.code === 'INVALID_CODE', r.text);
r = await raw('POST', '/api/auth/login-2fa', { challenge, code: totp(secret, Math.max(enrolStep, stepNow()) + 1) });
const codeCookie = r.cookie;
check('the next code signs in and sets a session', r.status === 200 && !!codeCookie && r.json.user.id === uid, r.text);
r = await raw('GET', '/api/auth/session', undefined, codeCookie);
check('that session works', r.status === 200 && r.json.user.id === uid, r.text);

r = await raw('POST', '/api/auth/login', { email, password });
r = await raw('POST', '/api/auth/login-2fa', { challenge: r.json.challenge, code: backups[0].toUpperCase() });
check('a backup code signs in (any letter case)', r.status === 200 && !!r.cookie, r.text);
r = await raw('POST', '/api/auth/login', { email, password });
r = await raw('POST', '/api/auth/login-2fa', { challenge: r.json.challenge, code: backups[0] });
check('the same backup code cannot be used twice 401', r.status === 401, r.text);
r = await callAsUser(me(), 'GET', '/api/account');
check('9 backup codes left', r.json?.twoStep?.backupCodesLeft === 9, r.text);

/* ---------------- wrong codes lock the account ---------------- */
r = await raw('POST', '/api/auth/login', { email, password });
const ch2 = r.json.challenge;
let last;
for (let i = 0; i < 5; i++) last = await raw('POST', '/api/auth/login-2fa', { challenge: ch2, code: '999999' === totp(secret, stepNow()) ? '888888' : '999999' });
check('five wrong codes lock the account 423', last.status === 423, last.text);
r = await raw('POST', '/api/auth/login-2fa', { challenge: ch2, code: totp(secret, stepNow() + 1) });
check('while locked even the right code is refused 423', r.status === 423, r.text);
r = await call('GET', '/api/users');
check('Users list shows Locked', r.json.data.find(u => u.id === uid)?.isLocked === true);
r = await call('POST', `/api/users/${uid}/security`, { action: 'unlock' });
check('management unlocks 200', r.status === 200, r.text);

/* ---------------- sign-in record ---------------- */
r = await call('GET', `/api/users/sign-ins?user=${uid}&pageSize=100`);
const results = (r.json?.data ?? []).map(e => `${e.result}/${e.method}`);
const has = (x) => results.includes(x);
check('sign-in record has password, code, backup-code, failed-code and locked rows',
  r.status === 200 && has('success/password') && has('success/totp') && has('success/backup_code') && has('2fa_failed/totp') && has('2fa_failed/backup_code') && has('locked/totp'), results.join(','));
check('rows carry the user agent', r.json.data.some(e => e.userAgent === 'security-2fa-check'), r.text);
r = await call('GET', `/api/users/sign-ins?user=${uid}&result=locked`);
check('filter by result', r.json.total >= 1 && r.json.data.every(e => e.result === 'locked'), r.text);
const today = new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
r = await call('GET', `/api/users/sign-ins?from=${today}&to=${today}&pageSize=25`);
check('filter by date, paged 25', r.status === 200 && r.json.total >= results.length && r.json.data.length <= 25, r.text);
r = await call('GET', '/api/users/sign-ins?from=2000-01-01&to=2000-01-02');
check('a date with no sign-ins is empty', r.json.total === 0, r.text);
r = await call('GET', '/api/users/sign-ins', undefined, 'operations_manager');
check('operations manager cannot see the sign-in record 403', r.status === 403, r.text);
r = await call('GET', '/api/users/sign-ins?result=nope');
check('unknown result filter 422', r.status === 422, r.text);
r = await callAsUser(me(), 'GET', '/api/account');
check('My account lists their recent sign-ins', r.json.recentSignIns.length > 0 && r.json.recentSignIns.length <= 10, r.text);

/* ---------------- required per role ---------------- */
const email2 = `norequired${tag}@example.com`;
r = await call('POST', '/api/users', { fullName: 'Not Enrolled', email: email2, role: 'operations_staff' });
const uid2 = r.json?.id;
const them = { userId: uid2, email: email2, role: 'operations_staff', fullName: 'Not Enrolled', iat: Date.now() };
r = await call('PUT', '/api/settings', { security: { require2faRoles: 'operations_staff,finance' } });
check('settings refuse an unknown role 422', r.status === 422, r.text);
r = await call('PUT', '/api/settings', { security: { require2faRoles: 'operations_staff' } });
check('management requires two-step for operations staff', r.status === 200, r.text);
r = await callAsUser(them, 'GET', '/api/auth/session');
check('session says set-up is required', r.status === 200 && r.json.user.twoStepSetupRequired === true, r.text);
r = await callAsUser(them, 'GET', '/api/settings');
check('until set up, other screens answer TWO_STEP_REQUIRED 403', r.status === 403 && r.json.error.code === 'TWO_STEP_REQUIRED', r.text);
r = await callAsUser(them, 'GET', '/api/account');
check('My account still opens', r.status === 200 && r.json.twoStep.requiredForRole === true, r.text);
r = await callAsUser(me(), 'GET', '/api/settings');
check('someone already enrolled is not held back', r.status !== 403 || r.json.error.code !== 'TWO_STEP_REQUIRED', r.text);
r = await callAsUser(me(), 'POST', '/api/account/2fa/disable', { password });
check('cannot turn it off while the role requires it 409', r.status === 409, r.text);
r = await call('PUT', '/api/settings', { security: { require2faRoles: '' } });
check('requirement lifted', r.status === 200, r.text);
r = await callAsUser(them, 'GET', '/api/settings');
check('then the other screens open again', r.status === 200, r.text);

/* ---------------- management resets it ---------------- */
r = await call('POST', `/api/users/${uid}/security`, { action: 'reset_2fa' }, 'operations_manager');
check('operations manager cannot reset two-step 403', r.status === 403, r.text);
r = await call('POST', `/api/users/${uid}/security`, { action: 'reset_2fa' });
check('management resets two-step 200', r.status === 200, r.text);
r = await callAsUser(me(), 'GET', '/api/account');
check('after the reset it is off with no backup codes', r.json.twoStep.enabled === false && r.json.twoStep.backupCodesLeft === 0, r.text);
r = await raw('POST', '/api/auth/login', { email, password });
check('and they sign in with the password alone again', r.status === 200 && !!r.cookie && !r.json.twoStep, r.text);
const realCookie = r.cookie;

/* ---------------- sign out other devices / everywhere ---------------- */
const old = me(Date.now() - 400);
r = await callAsUser(me(Date.now() - 500), 'POST', '/api/account/sign-out-others');
check('sign out other devices 200', r.status === 200, r.text);
r = await callAsUser(old, 'GET', '/api/auth/session');
check('an older session is now refused 401', r.status === 401, r.text);
await new Promise(res => setTimeout(res, 10));
r = await raw('POST', '/api/auth/login', { email, password });
const fresh = r.cookie;
r = await raw('GET', '/api/auth/session', undefined, fresh);
check('a real browser session works', r.status === 200, r.text);
r = await call('POST', `/api/users/${uid}/security`, { action: 'revoke_sessions' });
check('management signs them out everywhere 200', r.status === 200, r.text);
r = await raw('GET', '/api/auth/session', undefined, fresh);
check('that real session is killed 401', r.status === 401, r.text);
r = await raw('GET', '/api/auth/session', undefined, realCookie);
check('and the earlier one too 401', r.status === 401, r.text);

done();
