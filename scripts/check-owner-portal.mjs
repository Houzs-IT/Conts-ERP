// Owner portal safety checks against the LOCAL dev server (npm run dev, then
// load scripts/seed-owner-demo.sql locally). Run: node scripts/check-owner-portal.mjs
// Reads the local demo password from login.local. Never point this at a live site.
import { readFileSync } from 'node:fs';
const PW = readFileSync('login.local', 'utf8').match(/^Password: (.+)$/m)[1].trim();
const base = (door) => `http://${door ? door + '.' : ''}localhost:8788`;
let pass = 0, failN = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : failN++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
async function login(door, email) {
  const r = await fetch(base(door) + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  const body = await r.json(); const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  return { status: r.status, body, call: async (m, p, b) => { const x = await fetch(base(door) + p, { method: m, headers: { cookie, 'content-type': 'application/json' }, body: b && JSON.stringify(b) }); let j = null; try { j = await x.json(); } catch {} return { status: x.status, body: j }; } };
}
// Doors
let r = await login('owner', 'zaimzane@gmail.com'); check('owner door refuses staff (management)', r.status === 403 && r.body.error?.code === 'WRONG_DOOR', r.body.error?.message);
r = await login('owner', 'nurul@theconts.com'); check('owner door refuses housekeeper', r.status === 403);
const lim = await login('owner', 'limck@example.com'); check('owner door accepts owner', lim.status === 200 && lim.body.home === '/owner');
r = await login('ops', 'limck@example.com'); check('ops door refuses owner', r.status === 403 && r.body.error?.code === 'WRONG_DOOR', r.body.error?.message);
r = await login('ops', 'zaimzane@gmail.com'); check('ops door accepts staff', r.status === 200);
r = await login(null, 'limck@example.com'); check('plain localhost accepts owner (portal not decided)', r.status === 200);
r = await login('owner', 'nobody@example.com'); check('unknown email gets the normal error, not the door message', r.status === 401);
// Lim's portal figures
const p = await lim.call('GET', '/api/owner/portal'); const d = p.body;
check('portal loads', p.status === 200, p.status !== 200 ? JSON.stringify(p.body) : '');
check('shows August statement, net RM 6,482.00', d.statement?.periodStart === '2026-08-01' && d.statement.netPayout === 648200);
check('provisional September hidden', !d.earnings.some((e) => e.periodStart === '2026-09-01') && d.statement.state !== 'provisional');
check('statement lines add up to net', d.statement.lines.reduce((a, l) => a + l.amount, 0) === d.statement.netPayout, d.statement.lines.map((l) => l.label + ' ' + l.amount / 100).join('; '));
check('payout paid, Maybank 4417', d.payout?.state === 'paid' && d.payout.bankLast4 === '4417');
check('8 months of earnings', d.earnings.length === 8, d.earnings.map((e) => e.netPayout / 100).join(','));
check('occupancy 28 of 31 nights', d.stats.nightsBooked === 28 && d.stats.nightsAvailable === 31, `${d.stats.occupancy}%, ADR RM ${d.stats.adr / 100}, ${d.stats.bookings} bookings, rating ${d.stats.rating} (${d.stats.reviews})`);
check('only Lim unit', d.units.length === 1 && d.units[0].unitNumber === '#A-12-03');
check('quote needing approval listed first', d.issues[0]?.needsApproval && d.issues[0].title === 'Blackout curtains');
check('no other owner issue', !d.issues.some((i) => i.title === 'Sofa reupholstery'));
check('no guest names or contacts in payload', !/guest_?name|phone|email/i.test(JSON.stringify(d.issues) + JSON.stringify(d.stats)));
// Owner blocked from staff endpoints
for (const [m, path] of [['GET', '/api/reservations'], ['GET', '/api/guests'], ['GET', '/api/owners'], ['GET', '/api/messages'], ['GET', '/api/units'], ['GET', '/api/access-credentials'], ['GET', '/api/users'], ['GET', '/api/maintenance/issues'], ['GET', '/api/statements'], ['POST', '/api/reservations'], ['POST', '/api/tasks/complete']]) {
  const x = await lim.call(m, path, m === 'POST' ? {} : undefined); check(`owner blocked: ${m} ${path}`, x.status === 403, String(x.status));
}
// Statement PDF
check('own statement PDF opens', (await lim.call('GET', '/api/statements/pdf?id=5a000000-0000-4000-8000-000000000108')).status === 200);
check('other owner statement PDF refused', (await lim.call('GET', '/api/statements/pdf?id=5a000000-0000-4000-8000-000000000208')).status === 403);
const prov = (await lim.call('GET', '/api/statements/pdf?id=5a000000-0000-4000-8000-000000000109')).status;
check('provisional statement PDF refused to owner', prov !== 200, String(prov));
// Approvals
check('cannot approve another owner quote', (await lim.call('POST', '/api/maintenance/approve', { issueId: '3a000000-0000-4000-8000-000000000201', approved: true, quotedAmount: 120000 })).status === 403);
check('changed amount refused', (await lim.call('POST', '/api/maintenance/approve', { issueId: '3a000000-0000-4000-8000-000000000101', approved: true, quotedAmount: 1 })).status === 409);
const nurul = await login(null, 'nurul@theconts.com');
check('housekeeper cannot approve', (await nurul.call('POST', '/api/maintenance/approve', { issueId: '3a000000-0000-4000-8000-000000000101', approved: true, quotedAmount: 89000 })).status === 403);
check('owner approves own quote', (await lim.call('POST', '/api/maintenance/approve', { issueId: '3a000000-0000-4000-8000-000000000101', approved: true, quotedAmount: 89000 })).status === 200);
check('cannot approve twice', (await lim.call('POST', '/api/maintenance/approve', { issueId: '3a000000-0000-4000-8000-000000000101', approved: true, quotedAmount: 89000 })).status === 409);
check('approved quote no longer asks', !(await lim.call('GET', '/api/owner/portal')).body.issues.some((i) => i.needsApproval));
// Second owner and staff view-as
const wong = await login('owner', 'wongml@example.com'); const w = (await wong.call('GET', '/api/owner/portal')).body;
check('Wong sees her own RM 4,120.00, not Lim figures', w.statement.netPayout === 412000 && w.units[0].unitNumber === '#B-08-11' && w.earnings.length === 1);
const fin = await login(null, 'finance@theconts.com');
check('finance can view as an owner', (await fin.call('GET', '/api/owner/portal?ownerId=22222222-2222-4222-8222-000000000001')).status === 200);
check('housekeeper cannot view as an owner', (await nurul.call('GET', '/api/owner/portal?ownerId=22222222-2222-4222-8222-000000000001')).status === 403);
check('staff still reach staff endpoints', (await fin.call('GET', '/api/statements')).status === 200);
console.log(`\n${pass} passed, ${failN} failed`);
process.exitCode = failN ? 1 : 0;
