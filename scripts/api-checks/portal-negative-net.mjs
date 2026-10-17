// Owner portal per-unit net on a month whose net income is negative (TODO from PR #284). The operator's share is a
// percentage of the net income, so on a loss month it is negative too; the portal used to take its absolute value and
// subtract it, showing a lower per-unit net than the staff statement and the hero (RM -122.76 vs RM -73.66 on demo data).
// A bill larger than the month's income makes one unit's month negative; then every unit's net on the owner portal must
// equal the staff statement's net payout for that unit, the units must add up to the statement, and the hero's
// gross-to-net lines must add up to its Net Payout to Owner.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55632/postgres API_BASE=http://localhost:8931 node scripts/api-checks/portal-negative-net.mjs
import postgres from 'postgres';
import { call, callAsUser, cookieFor, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

const [unit] = await db(`SELECT u.id, u.owner_id, o.user_id, ou.email, ou.full_name FROM units u JOIN owners o ON o.id = u.owner_id JOIN users ou ON ou.id = o.user_id
  WHERE u.parent_unit_id IS NULL ORDER BY u.id LIMIT 1`);
check('a unit whose owner has a portal login', !!unit, 'none in the demo data');
const owner = { userId: unit.user_id, email: unit.email, role: 'owner', fullName: unit.full_name };
const taken = new Set((await db(`SELECT substr(period_start, 1, 7) AS m FROM owner_statements WHERE owner_id = $1`, unit.owner_id)).map(x => x.m));
const month = ['2026-07', '2026-06', '2026-05', '2026-10', '2026-11', '2026-12'].find(m => !taken.has(m));
check('an open month for this owner', !!month, [...taken].join(','));

const fd = new FormData();
fd.append('file', new Blob(['%PDF-1.4 receipt'], { type: 'application/pdf' }), 'big-repair.pdf');
fd.append('unitId', unit.id); fd.append('kind', 'receipt');
const up = await fetch(`${BASE}/api/documents`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: fd });
const receipt = (await up.json().catch(() => null))?.id;
check('receipt uploaded', up.status === 201 && !!receipt);

// RM 50,000: more than any demo unit earns in a month.
let r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'maintenance', amount: 5000000, incurredOn: `${month}-20`, chargeTo: 'owner', description: 'Water damage repair', receiptDocumentId: receipt });
check('large owner-paid bill recorded', r.status === 201, r.text);

r = await call('POST', '/api/statements/generate', { period: month, ownerIds: [unit.owner_id] });
check('owner statement generated', r.status < 300 && r.json?.count >= 1, `${r.status} ${r.text}`);
const [st] = await db(`SELECT id FROM owner_statements WHERE owner_id = $1 AND period_start LIKE $2`, unit.owner_id, `${month}%`);
r = await call('GET', `/api/statements/${st.id}`);
const staff = r.json?.data;
const staffUnit = (staff?.units ?? []).find(u => u.unitId === unit.id);
check('staff statement: the unit\'s net income is negative', staffUnit && staffUnit.netIncome < 0, JSON.stringify(staffUnit));
check('staff statement: the operator\'s share on that unit is negative (it carries its part of the loss)', staffUnit && staffUnit.netIncome - staffUnit.payoutBeforeAdjustments < 0, JSON.stringify(staffUnit));

r = await call('POST', '/api/statements/finalise', { statementIds: [st.id] });
check('statement finalised', r.status === 200, r.text);

r = await callAsUser(owner, 'GET', `/api/owner/statements/${st.id}`);
const portal = r.json;
check('owner portal statement opens', r.status === 200, r.text);
for (const su of staff.units) {
  const pu = (portal?.units ?? []).find(u => u.id === su.unitId);
  check(`per-unit net matches the staff statement (${su.label})`, pu && pu.net === Number(su.netPayout), `portal ${pu?.net} vs staff ${su.netPayout}`);
  const lineSum = (pu?.lines ?? []).reduce((n, l) => n + l.amount, 0);
  check(`per-unit lines add up to the unit's net (${su.label})`, pu && lineSum === pu.net, `lines ${lineSum} vs net ${pu?.net}`);
}
const unitSum = (portal?.units ?? []).reduce((n, u) => n + u.net, 0);
check('portal unit nets add up to the statement\'s net payout', unitSum === portal?.netPayout && portal?.netPayout === Number(staff.totals.netPayout), `${unitSum} / ${portal?.netPayout} / ${staff.totals.netPayout}`);

r = await callAsUser(owner, 'GET', `/api/owner/summary?period=${month}`);
const g2n = r.json?.grossToNet ?? [];
const net = g2n.find(l => l.type === 'net');
const sum = g2n.filter(l => l.type !== 'net').reduce((n, l) => n + l.amount, 0);
check('hero: gross-to-net lines add up to Net Payout to Owner', r.status === 200 && net && sum === net.amount && net.amount === Number(staff.totals.netPayout), `${sum} vs ${net?.amount} (${JSON.stringify(g2n)})`);
done();
