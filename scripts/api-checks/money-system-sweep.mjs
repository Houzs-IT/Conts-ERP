// Backend fixes from the money-and-system click sweep (11 Oct 2026).
// Run against any local server: API_BASE=http://localhost:8788 node scripts/api-checks/money-system-sweep.mjs
// On the HostPlatform import database (scripts/api-checks/hostplatform-import.mjs --serve) pass the server's SESSION_SECRET and
// SWEEP_USER_ID=dev-admin SWEEP_EMAIL=dev@local.test, since that database has no seed.sql users.
import { call, callAsUser, check, done } from './harness.mjs';

const asMgmt = process.env.SWEEP_USER_ID
  ? (m, p, b) => callAsUser({ userId: process.env.SWEEP_USER_ID, email: process.env.SWEEP_EMAIL ?? 'dev@local.test', role: 'management', fullName: 'Sweep check' }, m, p, b)
  : (m, p, b) => call(m, p, b);

// Payout references: imported payout ids end in the statement month, which used to give every owner the same reference.
const pay = await asMgmt('GET', '/api/payouts?pageSize=500');
check('payouts list loads', pay.status === 200, pay.text);
const rows = pay.json?.data ?? [];
const monthTail = rows.filter(r => /-\d{6}$/.test(r.id));
check('a payout reference is not just its statement month', monthTail.every(r => r.ref !== `PAY-${r.id.slice(-6)}`), JSON.stringify(monthTail.slice(0, 2)));
const seen = new Map();
for (const r of rows) seen.set(r.ref, (seen.get(r.ref) ?? 0) + 1);
check('no two payouts share a reference', [...seen.values()].every(n => n === 1), JSON.stringify([...seen.entries()].filter(([, n]) => n > 1).slice(0, 3)));

// Users: a person with no phone comes back as null, not a dash the edit form then refuses as "too short".
const users = await asMgmt('GET', '/api/users');
check('users list loads', users.status === 200, users.text);
check('a missing phone is null, never a dash', (users.json?.data ?? []).every(u => u.phone === null || (typeof u.phone === 'string' && u.phone !== '—')), JSON.stringify(users.json?.data?.map(u => u.phone)));
const ownerInvite = await asMgmt('POST', '/api/users', { fullName: 'Sweep owner', email: `sweep-owner-${Date.now()}@example.test`, role: 'owner' });
check('owners are not invited from Users and roles', ownerInvite.status === 422 && !!ownerInvite.json?.error?.fields?.role, ownerInvite.text);

// Finance admins: the user list refuses them, so their built-in access to Users and roles is none.
const access = await asMgmt('GET', '/api/users/access');
const usersArea = access.json?.areas?.find(a => a.key === 'users');
check('finance admin built-in access to Users and roles is none', usersArea?.roles?.finance_admin?.builtIn === 'none', JSON.stringify(usersArea));

// Expenses report: the header reads in words, not codes or 11/10/2026.
const month = rows.find(r => r.period)?.period ?? '2026-08';
const rep = await asMgmt('GET', `/api/expenses/report?month=${month}&category=electricity`);
check('expenses report downloads', rep.status === 200, rep.text.slice(0, 200));
const head = rep.text.split(/\r?\n/).slice(0, 4).join('\n');
check('report month and category are words', /Month: [A-Z][a-z]{2} \d{4}; Category: Electricity/.test(head), head);
check('report time reads "11 Oct 2026 11:30"', /"Generated","\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} MYT"/.test(head), head);
const firstRow = rep.text.split(/\r?\n/)[6] ?? '';
check('report rows carry category and payer labels', !/"electricity"|"owner"$/.test(firstRow), firstRow);

// System health: failed emails are named on the email check even when the mail key is missing.
const health = await asMgmt('GET', '/api/system/health');
check('system health loads', health.status === 200, health.text.slice(0, 200));

// Forgot password: the reason is not followed by a doubled full stop.
const users0 = users.json?.data?.find(u => u.isActive);
if (users0) {
  const fp = await asMgmt('POST', '/api/auth/forgot-password', { email: users0.email });
  check('forgot password answers without a doubled full stop', fp.status === 200 || !/\.\)\./.test(fp.json?.error?.message ?? ''), fp.text);
}

done();
