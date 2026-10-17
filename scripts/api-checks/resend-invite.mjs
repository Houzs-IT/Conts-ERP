// Re-sending invitations, staff and owner (feat/resend-invite):
//   POST /api/users/:id/resend-invite    management only
//   POST /api/owners/:id/resend-invite   management and operations managers
//   POST /api/owners/:id/reset-email     management and operations managers, for an owner who already signed in
// Checks the role gates, that only a login that never signed in can be re-invited (409 after the first sign-in), that
// each resend really replaces the stored password and emails again (a second resend in the same hour is not swallowed
// by notify()'s hourly de-duplication), that every send reports its delivery state, and the audit rows the screens
// read "last invited" from.
//
// Run against a throwaway database and a local server (SESSION_SECRET=smoke-test-secret-not-real-0123456789):
//   DB_URL=postgres://postgres@127.0.0.1:5432/ci API_BASE=http://localhost:8788 node scripts/api-checks/resend-invite.mjs
// DB_URL is required: the temporary password is never returned, so rotation is checked on the stored hash.
// It adds accounts and an owner; it does not clean up.
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL) { console.error('DB_URL is required (see the header).'); process.exit(2); }
const sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {}, connection: { search_path: 'pos' } });
const q = async (text, ...args) => sql.unsafe(text, args);
const hashOf = async (id) => (await q('SELECT password_hash FROM users WHERE id = $1', id))[0]?.password_hash;
const audits = async (table, id, action) => Number((await q('SELECT count(*)::int AS n FROM audit_log WHERE entity_table = $1 AND entity_id = $2 AND action = $3', table, id, action))[0].n);
const invitesLogged = async (userId) => Number((await q("SELECT count(*)::int AS n FROM notification_log WHERE template = 'account.invited' AND entity_id = $1", userId))[0].n);
const deliveryOk = (j) => ['sent', 'queued', 'failed'].includes(j?.delivery);
const tag = Date.now().toString().slice(-7);

/* ------------------------------- staff ------------------------------- */
let r = await call('POST', '/api/users', { fullName: `Resend Staff ${tag}`, email: `resend.staff.${tag}@example.com`, role: 'operations_staff' });
check('staff: invite created (201) and reports delivery', r.status === 201 && deliveryOk(r.json), r.text);
const staffId = r.json?.id;
const h0 = await hashOf(staffId);

for (const role of ['operations_manager', 'operations_staff', 'finance_admin', 'housekeeper', 'technician']) {
  r = await call('POST', `/api/users/${staffId}/resend-invite`, {}, role);
  check(`staff: ${role} refused (403)`, r.status === 403, r.text);
}
check('staff: refused calls left the password alone', (await hashOf(staffId)) === h0);

r = await call('POST', `/api/users/${staffId}/resend-invite`, {});
check('staff: management resends (200) and gets the delivery state', r.status === 200 && deliveryOk(r.json), r.text);
if (r.json?.delivery === 'failed') check('staff: no mail key is reported as such', /not configured/i.test(r.json.reason ?? ''), r.text);
const h1 = await hashOf(staffId);
check('staff: password rotated on resend', h1 && h1 !== h0);
check('staff: still must choose a password at first sign-in', (await q('SELECT must_change_password FROM users WHERE id = $1', staffId))[0].must_change_password == 1);
check('staff: audit row user.resend_invite', (await audits('users', staffId, 'user.resend_invite')) === 1);

r = await call('POST', `/api/users/${staffId}/resend-invite`, {});
const h2 = await hashOf(staffId);
check('staff: a second resend in the same hour rotates again', r.status === 200 && h2 !== h1, r.text);
check('staff: and is really sent again, not de-duplicated (3 invitation emails logged)', (await invitesLogged(staffId)) === 3, String(await invitesLogged(staffId)));

r = await call('GET', '/api/users');
const listed = r.json?.data?.find(u => u.id === staffId);
const newest = (await q("SELECT max(occurred_at) AS t FROM audit_log WHERE entity_table = 'users' AND entity_id = $1 AND action IN ('user.invite', 'user.resend_invite')", staffId))[0].t;
check('staff: list shows when the newest invitation went out', listed && listed.lastInvitedAt === newest, JSON.stringify(listed));

await q('UPDATE users SET last_login_at = $1, must_change_password = 0 WHERE id = $2', new Date().toISOString(), staffId);
r = await call('POST', `/api/users/${staffId}/resend-invite`, {});
check('staff: after the first sign-in, resend is refused (409 ALREADY_ACTIVE)', r.status === 409 && r.json?.error?.code === 'ALREADY_ACTIVE', r.text);
check('staff: and the working password is untouched', (await hashOf(staffId)) === h2);

r = await call('POST', '/api/users/does-not-exist/resend-invite', {});
check('staff: unknown account 404', r.status === 404, r.text);

/* ------------------------------- owner ------------------------------- */
r = await call('POST', '/api/owners', { displayName: `Resend Owner ${tag}`, email: `resend.owner.${tag}@example.com` });
check('owner: created', r.status === 201, r.text);
const ownerId = r.json?.id;

r = await call('POST', `/api/owners/${ownerId}/resend-invite`, {});
check('owner: resend before any invite is refused (409 NOT_INVITED)', r.status === 409 && r.json?.error?.code === 'NOT_INVITED', r.text);

r = await call('POST', `/api/owners/${ownerId}/invite`, {});
check('owner: invite (201) now reports delivery', r.status === 201 && deliveryOk(r.json), r.text);
const ownerUser = r.json?.userId;
const o0 = await hashOf(ownerUser);

r = await call('GET', `/api/owners?id=${ownerId}`);
const p0 = r.json?.data?.[0]?.portal;
check('owner: profile says invited, not signed in yet, with the invite date', p0?.state === 'invited' && !!p0?.invitedAt, JSON.stringify(p0));

for (const role of ['operations_staff', 'finance_admin', 'housekeeper', 'technician']) {
  r = await call('POST', `/api/owners/${ownerId}/resend-invite`, {}, role);
  check(`owner: ${role} refused resend (403)`, r.status === 403, r.text);
  r = await call('POST', `/api/owners/${ownerId}/reset-email`, {}, role);
  check(`owner: ${role} refused reset email (403)`, r.status === 403, r.text);
}
check('owner: refused calls left the password alone', (await hashOf(ownerUser)) === o0);

r = await call('POST', `/api/owners/${ownerId}/resend-invite`, {}, 'operations_manager');
check('owner: operations manager resends (200) with delivery state', r.status === 200 && deliveryOk(r.json), r.text);
if (r.json?.delivery === 'failed') check('owner: no mail key is reported as such', /not configured/i.test(r.json.reason ?? ''), r.text);
const o1 = await hashOf(ownerUser);
check('owner: password rotated on resend', o1 && o1 !== o0);
r = await call('POST', `/api/owners/${ownerId}/resend-invite`, {});
const o2 = await hashOf(ownerUser);
check('owner: management resends again in the same hour, rotated again', r.status === 200 && o2 !== o1, r.text);
check('owner: audit rows owner.resend_invite x2', (await audits('owners', ownerId, 'owner.resend_invite')) === 2);
check('owner: each resend emailed (3 invitation emails logged)', (await invitesLogged(ownerUser)) === 3, String(await invitesLogged(ownerUser)));

await q('UPDATE users SET last_login_at = $1, must_change_password = 0 WHERE id = $2', new Date().toISOString(), ownerUser);
r = await call('POST', `/api/owners/${ownerId}/resend-invite`, {});
check('owner: after the first sign-in, resend is refused (409 ALREADY_ACTIVE)', r.status === 409 && r.json?.error?.code === 'ALREADY_ACTIVE' && /reset/i.test(r.json?.error?.message ?? ''), r.text);
check('owner: and the working password is untouched', (await hashOf(ownerUser)) === o2);
r = await call('GET', `/api/owners?id=${ownerId}`);
check('owner: profile now says portal active', r.json?.data?.[0]?.portal?.state === 'active', JSON.stringify(r.json?.data?.[0]?.portal));

const tokensBefore = Number((await q('SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1', ownerUser))[0].n);
r = await call('POST', `/api/owners/${ownerId}/reset-email`, {}, 'operations_manager');
check('owner: reset email for an active owner (200) with delivery state', r.status === 200 && deliveryOk(r.json), r.text);
check('owner: a reset token was made', Number((await q('SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1', ownerUser))[0].n) === tokensBefore + 1);
check('owner: audit row owner.reset_email', (await audits('owners', ownerId, 'owner.reset_email')) === 1);
check('owner: reset email leaves the password alone', (await hashOf(ownerUser)) === o2);

r = await call('POST', '/api/owners/does-not-exist/resend-invite', {});
check('owner: unknown owner 404', r.status === 404, r.text);

await sql.end();
done();
