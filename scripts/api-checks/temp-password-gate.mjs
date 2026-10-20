// An account still on its emailed temporary password (users.must_change_password = 1: a new invite, or management's
// Reset password) can only read its own session, sign out, and set a new password. Every other endpoint answers 403
// PASSWORD_CHANGE_REQUIRED (functions/api/_middleware.ts), so a leaked invite email opens nothing. After the change the
// same cookie works normally. Covers a technician (field app), operations staff (desk) and an invited owner (portal).
//
// Run against a throwaway database and a local server (SESSION_SECRET=smoke-test-secret-not-real-0123456789):
//   API_BASE=http://localhost:8788 node scripts/api-checks/temp-password-gate.mjs
// It adds accounts and an owner; it does not clean up.
import { call, callAsUser, check, done } from './harness.mjs';

const tag = Date.now().toString().slice(-7);
const gated = (r) => r.status === 403 && r.json?.error?.code === 'PASSWORD_CHANGE_REQUIRED';

async function invited(role) {
  const email = `gate.${role}.${tag}@example.com`;
  const r = await call('POST', '/api/users', { fullName: `Gate ${role} ${tag}`, email, role });
  check(`${role}: invited (201)`, r.status === 201 && r.json?.id, r.text);
  return { userId: r.json?.id, email, role, fullName: `Gate ${role} ${tag}` };
}

// strict: each blocked GET must answer 200 afterwards. A new owner has no units or statements, so for them it is
// enough that the gate has lifted (no PASSWORD_CHANGE_REQUIRED, no server error).
async function walk(u, label, blocked, strict = true) {
  let r = await callAsUser(u, 'GET', '/api/auth/session');
  check(`${label}: session answers and says a new password is due`, r.status === 200 && r.json?.user?.mustChangePassword === true, r.text);
  for (const [method, path] of blocked) {
    r = await callAsUser(u, method, path, method === 'GET' ? undefined : {});
    check(`${label}: ${method} ${path} refused before the change (403 PASSWORD_CHANGE_REQUIRED)`, gated(r), `${r.status} ${r.text.slice(0, 200)}`);
  }
  r = await callAsUser(u, 'GET', '/api/account');
  check(`${label}: My account refused too`, gated(r), r.text.slice(0, 200));
  // Harness cookies carry no browser id (sid), so signing out here leaves the same cookie usable for the rest.
  r = await callAsUser(u, 'POST', '/api/auth/logout');
  check(`${label}: can still sign out`, r.status === 204, `${r.status} ${r.text}`);
  r = await callAsUser(u, 'POST', '/api/auth/change-password', { password: 'short' });
  check(`${label}: a weak new password is still checked (422)`, r.status === 422, r.text);
  r = await callAsUser(u, 'POST', '/api/auth/change-password', { password: `Gate${tag}x1` });
  check(`${label}: sets a new password (200)`, r.status === 200, r.text);
  r = await callAsUser(u, 'GET', '/api/auth/session');
  check(`${label}: session no longer asks for one`, r.status === 200 && r.json?.user?.mustChangePassword === false, r.text);
  for (const [method, path] of blocked.filter(([m]) => m === 'GET')) {
    r = await callAsUser(u, method, path);
    check(`${label}: ${method} ${path} answers after the change`, strict ? r.status === 200 : !gated(r) && r.status < 500, `${r.status} ${r.text.slice(0, 200)}`);
  }
}

// The reported case: an invited technician could list open repair jobs with unit addresses.
await walk(await invited('technician'), 'technician', [['GET', '/api/field/repairs'], ['GET', '/api/field/tasks'], ['POST', '/api/maintenance/issues']]);
await walk(await invited('operations_staff'), 'operations staff', [['GET', '/api/reservations'], ['GET', '/api/units'], ['POST', '/api/reservations']]);

// An owner invited from their record on Owners.
let r = await call('POST', '/api/owners', { displayName: `Gate Owner ${tag}`, email: `gate.owner.${tag}@example.com` });
check('owner: record created', r.status === 201 && r.json?.id, r.text);
r = await call('POST', `/api/owners/${r.json?.id}/invite`, {});
check('owner: portal invite (201)', r.status === 201 && r.json?.userId, r.text);
await walk({ userId: r.json?.userId, email: `gate.owner.${tag}@example.com`, role: 'owner', fullName: `Gate Owner ${tag}` }, 'owner',
  [['GET', '/api/owner/summary'], ['GET', '/api/owner/documents'], ['GET', '/api/notifications']], false);

// Everyone else (must_change_password = 0) is untouched.
r = await call('GET', '/api/field/repairs', undefined, 'technician');
check('seeded technician still reads repairs', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);

done();
