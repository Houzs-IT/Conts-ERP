// Users > row actions: reset link, require new password, sign out everywhere, unlock (functions/api/users/[id]/security.ts),
// and the middleware refusing a session signed before sessions_revoked_at (migration 0055).
import { call, callAsUser, check, done } from './harness.mjs';

const tag = Date.now();
const email = `sec${tag}@example.com`;
let r = await call('POST', '/api/users', { fullName: 'Security Check', email, role: 'operations_staff' });
check('invite target user', r.status === 201, r.text);
const uid = r.json?.id;
const as = (iat) => ({ userId: uid, email, role: 'operations_staff', fullName: 'Security Check', iat });
const row = async () => (await call('GET', '/api/users')).json.data.find(u => u.id === uid);

r = await call('POST', `/api/users/${uid}/security`, { action: 'unlock' }, 'operations_manager');
check('ops manager cannot use security actions 403', r.status === 403, r.text);
r = await call('POST', `/api/users/${uid}/security`, { action: 'nope' });
check('unknown action 422', r.status === 422, r.text);
r = await call('POST', '/api/users/11111111-1111-4111-8111-000000000002/security', { action: 'revoke_sessions' });
check('cannot sign yourself out everywhere 422', r.status === 422, r.text);

const before = Date.now() - 60_000;
r = await callAsUser(as(before), 'GET', '/api/auth/session');
check('existing session works before revoke', r.status === 200, r.text);
r = await call('POST', `/api/users/${uid}/security`, { action: 'revoke_sessions' });
check('sign out everywhere 200', r.status === 200, r.text);
r = await callAsUser(as(before), 'GET', '/api/auth/session');
check('session signed before revoke is refused 401', r.status === 401, r.text);
r = await callAsUser(as(Date.now() + 1000), 'GET', '/api/auth/session');
check('a new sign-in after revoke works', r.status === 200, r.text);

// A fresh invite already has must_change_password set, so the proof that this ran is the sign-out.
const beforeForce = Date.now();
await new Promise(res => setTimeout(res, 5));
r = await call('POST', `/api/users/${uid}/security`, { action: 'force_change' });
check('require new password 200', r.status === 200, r.text);
r = await callAsUser(as(beforeForce), 'GET', '/api/auth/session');
check('require new password also signs them out 401', r.status === 401, r.text);
check('list shows must change password', (await row())?.mustChangePassword === true);

for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email, password: 'Wrong-password-1' });
check('five wrong passwords show Locked in the list', (await row())?.isLocked === true);
r = await call('POST', `/api/users/${uid}/security`, { action: 'unlock' });
check('unlock 200', r.status === 200, r.text);
check('list no longer shows locked', (await row())?.isLocked === false);

r = await call('POST', `/api/users/${uid}/security`, { action: 'reset_email' });
check('send reset link answers with a delivery state, no token', r.status === 200 && r.json.delivery && !/token=/.test(r.text), r.text);

r = await call('PATCH', `/api/users/${uid}`, { isActive: false });
check('switch off', r.status === 200, r.text);
r = await call('POST', `/api/users/${uid}/security`, { action: 'reset_email' });
check('no reset link for a switched-off account 422', r.status === 422, r.text);

done();
