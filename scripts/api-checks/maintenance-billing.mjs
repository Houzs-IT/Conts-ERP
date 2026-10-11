// Maintenance rework (11 Oct 2026): the short create form, the technician list deciding in-house or contractor,
// quote + billing date + who pays, owner approval (sent by the office only) reaching the owner's portal, the unit's expense dated the billing
// date (and following it), money collected and the contractor paid, on a finished job too.
// Needs migration 0108 applied, a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://postgres@127.0.0.1:55791/postgres API_BASE=http://localhost:8813 node scripts/api-checks/maintenance-billing.mjs
import postgres from 'postgres';
import { call, callAsUser, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
// One connection per query: PGlite serves one wire connection at a time, and the server needs it between.
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

const [unit] = await db(`SELECT u.id, u.unit_number, o.user_id, ou.email, ou.full_name FROM units u JOIN owners o ON o.id = u.owner_id JOIN users ou ON ou.id = o.user_id
  WHERE ou.is_active = 1 ORDER BY u.unit_number LIMIT 1`);
check('a unit whose owner has a portal login', !!unit, 'none in the demo data');
const owner = { userId: unit.user_id, email: unit.email, role: 'owner', fullName: unit.full_name };
const get = async (id) => (await call('GET', '/api/maintenance/issues')).json.data.find(x => x.id === id);

let r = await call('GET', '/api/maintenance/technicians');
check('technician list', r.status === 200 && r.json.data.some(t => t.name === 'Nurul Huda' && t.kind === 'in_house'), r.text.slice(0, 300));
r = await call('GET', '/api/maintenance/technicians', undefined, 'housekeeper');
check('technician list refused to field roles', r.status === 403, r.text);

// The create form sends only unit, problem, category and urgency.
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: 'Water heater not working', category: 'appliance', urgency: 'normal', reportSource: 'staff' });
check('create with unit and problem only', r.status === 201 && r.json.state === 'open', r.text);
const id = r.json.id;
let it = await get(id);
check('list says whether the owner has a portal login, and that billing is on', it.ownerHasLogin === true && it.billingDate === null, JSON.stringify(it));

r = await call('PATCH', `/api/maintenance/issues/${id}`, { assigneeName: 'Nurul Huda', assigneeKind: 'contractor' });
it = await get(id);
check('a staff account is in-house whatever the screen sends', r.status === 200 && it.assigneeKind === 'in_house' && it.state === 'assigned', JSON.stringify(it));
r = await call('PATCH', `/api/maintenance/issues/${id}`, { assigneeName: 'Kedai Elektrik Ah Seng' });
it = await get(id);
check('a name that is not a staff account is a contractor', r.status === 200 && it.assigneeKind === 'contractor', JSON.stringify(it));
r = await call('GET', '/api/maintenance/technicians');
check('a contractor used once is on the list next time', r.json.data.some(t => t.name === 'Kedai Elektrik Ah Seng' && t.kind === 'contractor'), r.text.slice(0, 300));

// Quote, billing date and payer in one save; under the threshold, no approval yet.
r = await call('PATCH', `/api/maintenance/issues/${id}`, { quotedAmount: 25000, billingDate: '2026-11-15', chargeTo: 'owner' });
it = await get(id);
check('quote, billing date and payer saved', r.status === 200 && it.quotedAmount === 25000 && it.billingDate === '2026-11-15' && it.chargeTo === 'owner' && it.state === 'assigned', JSON.stringify(it));
r = await call('PATCH', `/api/maintenance/issues/${id}`, { billingDate: '15/11/2026' });
check('a billing date that is not a day is refused', r.status === 422, r.text);
r = await call('PATCH', `/api/maintenance/issues/${id}`, { contractorAmount: 100 }, 'operations_staff');
check('operations staff cannot record money', r.status === 403, r.text);

// The button: send to the owner. The owner is told and sees it on the portal.
r = await call('POST', `/api/maintenance/issues/${id}/request-approval`, {});
check('send to owner for approval', r.status === 200, r.text);
r = await callAsUser(owner, 'GET', '/api/notifications');
check("the owner's own notice says a quote waits", r.status === 200 && r.json.data.some(n => n.kind === 'maintenance.owner_approval' && n.entityId === id && /RM 250\.00/.test(n.body ?? '')), r.text.slice(0, 400));
r = await callAsUser(owner, 'GET', '/api/owner/property-health');
const seen = r.json?.issues?.find(x => x.id === id);
check('the owner portal lists it as waiting with the quote', seen?.state === 'waiting' && seen?.quotedAmount === 25000, JSON.stringify(seen));
r = await call('POST', `/api/maintenance/issues/${id}/complete`, { finalAmount: 25000 });
check('cannot close before the owner approves', r.status === 409, r.text);
r = await callAsUser(owner, 'POST', `/api/maintenance/issues/${id}/approve`, { approved: true, quotedAmount: 25000 });
check('the owner approves on the portal', r.status === 200, r.text);

// Done: the expense is dated the billing date, not today.
r = await call('POST', `/api/maintenance/issues/${id}/complete`, { finalAmount: 26000 });
it = await get(id);
check('closing dates the unit expense on the billing date', r.status === 200 && r.json.expenseOn === '2026-11-15' && it.expensedOn === '2026-11-15' && it.expensed === 26000, r.text + JSON.stringify(it));
let rows = await db(`SELECT incurred_on, amount, category, charge_to FROM expenses WHERE maintenance_id = $1`, id);
check('one maintenance expense row, linked to the job', rows.length === 1 && rows[0].category === 'maintenance' && rows[0].charge_to === 'owner', JSON.stringify(rows));

// A finished job still takes the money follow-up, nothing else.
r = await call('PATCH', `/api/maintenance/issues/${id}`, { collectedAt: '2026-11-20', contractorAmount: 18000, contractorPaidAt: '2026-11-21' });
it = await get(id);
check('collected and contractor paid recorded on a finished job', r.status === 200 && it.collectedAt === '2026-11-20' && it.contractorAmount === 18000 && it.contractorPaidAt === '2026-11-21', r.text + JSON.stringify(it));
r = await call('PATCH', `/api/maintenance/issues/${id}`, { title: 'changed' });
check('other edits on a finished job still need a reopen', r.status === 409, r.text);
r = await call('PATCH', `/api/maintenance/issues/${id}`, { billingDate: '2026-12-02' });
it = await get(id);
check("a new billing date moves the unit's expense to that month", r.status === 200 && r.json.expenseMovedTo === '2026-12-02' && it.expensedOn === '2026-12-02', r.text + JSON.stringify(it));
r = await call('PATCH', `/api/maintenance/issues/${id}`, { collectedAt: null });
it = await get(id);
check('collected can be undone', r.status === 200 && it.collectedAt === null, JSON.stringify(it));

// Reopen and close again: still one expense, at the new figure.
await call('PATCH', `/api/maintenance/issues/${id}`, { state: 'reopened' });
r = await call('POST', `/api/maintenance/issues/${id}/complete`, { finalAmount: 27000 });
rows = await db(`SELECT incurred_on, amount FROM expenses WHERE maintenance_id = $1`, id);
check('closing again updates the one expense instead of adding a second', r.status === 200 && rows.length === 1 && Number(rows[0].amount) === 27000 && rows[0].incurred_on === '2026-12-02', JSON.stringify(rows));

// The History panel has the before and after.
r = await call('GET', `/api/audit?entityTable=maintenance_issues&entityId=${id}`);
const acts = JSON.stringify(r.json ?? r.text);
check('history records billing date, collected and contractor paid', r.status === 200 && /billingDate/.test(acts) && /contractorPaidAt/.test(acts) && /collectedAt/.test(acts), acts.slice(0, 300));

// No threshold any more (owner, 11 Oct): a large quote alone neither waits nor tells the owner; only the button does.
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: 'Replace aircon compressor', category: 'aircon' });
const big = r.json.id;
r = await call('PATCH', `/api/maintenance/issues/${big}`, { quotedAmount: 450000, chargeTo: 'owner' });
check('a large quote does not wait for the owner by itself', r.status === 200 && r.json.state !== 'waiting', r.text);
r = await callAsUser(owner, 'GET', '/api/notifications');
check('and the owner is not told until the office sends it', r.status === 200 && !r.json.data.some(n => n.kind === 'maintenance.owner_approval' && n.entityId === big), r.text.slice(0, 300));
r = await call('POST', `/api/maintenance/issues/${big}/request-approval`, {});
it = await get(big);
check('sending it makes it wait', r.status === 200 && it.state === 'waiting', JSON.stringify(it));
r = await call('PATCH', `/api/maintenance/issues/${big}`, { chargeTo: 'the_conts' });
check('the company paying instead stops the wait', r.status === 200 && r.json.state !== 'waiting', r.text);
r = await call('GET', '/api/maintenance/issues');
check('the list no longer carries a threshold', r.status === 200 && !('threshold' in r.json), Object.keys(r.json).join());
// Photos of the problem go up right after the job is made, also from a cleaner reporting damage.
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const { cookieFor } = await import('./harness.mjs');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf00000301010018dd8db40000000049454e44ae426082', 'hex');
const photo = async (issueId, role) => { const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'problem.png'); fd.append('kind', 'before');
  return (await fetch(`${BASE}/api/maintenance/issues/${issueId}/photos`, { method: 'POST', headers: { cookie: cookieFor(role) }, body: fd })).status; };
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: 'Cracked mirror', category: 'furniture', reportSource: 'cleaner', source: 'field_app' }, 'housekeeper');
check('a cleaner reports damage', r.status === 201, r.text);
check('and adds the photo of it', await photo(r.json.id, 'housekeeper') === 201);
const docs = await call('GET', `/api/maintenance/issues/${r.json.id}/documents`);
check("it is one of the job's Before photos", docs.json?.data?.length === 1 && docs.json.data[0].stage === 'before', docs.text.slice(0, 200));
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: 'Office job', category: 'other' });
check('a cleaner cannot add photos to a job they neither reported nor work on', await photo(r.json.id, 'housekeeper') === 403);
done();
