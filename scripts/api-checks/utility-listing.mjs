// The utility listing (plan docs/superpowers/plans/2026-10-28-utility-listing.md): every unit, its utility bills by bill
// month with whether the owner has been charged, and the nights booked. Read only.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://postgres@127.0.0.1:55441/postgres API_BASE=http://localhost:8891 node scripts/api-checks/utility-listing.mjs
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

// Two whole units of different owners, with months nobody has bills or statements for (2029).
const [a, b] = await db(`SELECT u.id, u.owner_id, u.property_id FROM units u WHERE u.parent_unit_id IS NULL AND u.owner_id IS NOT NULL ORDER BY u.id`)
  .then(us => [us[0], us.find(u => u.owner_id !== us[0]?.owner_id)]);
check('two units of different owners', !!a && !!b);
if (!a || !b) { done(); process.exit(1); }
for (const u of [a, b]) {
  await db(`DELETE FROM expenses WHERE unit_id = $1 AND incurred_on >= '2029-01-01' AND incurred_on < '2030-01-01'`, u.id);
  await db(`DELETE FROM owner_statements WHERE owner_id = $1 AND period_start >= '2029-01-01' AND period_start < '2030-01-01'`, u.owner_id);
}
const bill = async (o) => {
  const id = randomUUID();
  await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, rolled, record_only, charge_to, created_at)
    VALUES ($1, $2, $3, 'Utility check', $4, 'MYR', $5, $6, $7, $8, $9, now())`,
    id, a.id, o.kind, o.amount, o.date, o.deduct ?? o.date.slice(0, 7), !!o.rolled, !!o.recordOnly, o.chargeTo ?? 'owner');
  return id;
};
const charged = await bill({ kind: 'electricity', amount: 12345, date: '2029-03-31' });
const pending = await bill({ kind: 'water', amount: 2000, date: '2029-02-28' });
const company = await bill({ kind: 'internet', amount: 10494, date: '2029-03-31', chargeTo: 'company' });
const record = await bill({ kind: 'sewerage', amount: 800, date: '2029-03-31', recordOnly: true });
const rolled = await bill({ kind: 'water', amount: 3000, date: '2029-04-30', deduct: '2029-05', rolled: true });
// March is final for unit a's owner; May is not.
await db(`INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, generated_at, created_at)
  VALUES ($1, $2, '2029-03-01', '2029-03-31', 'finalised', now()::text, now()::text)`, randomUUID(), a.owner_id).catch(e => check('final March statement seeded', false, e.message));
// A stay of 3 nights in March and 2 in April (check-in 29 March, check-out 3 April).
const [guest] = await db(`SELECT id FROM guests LIMIT 1`);
await db(`INSERT INTO reservations (id, unit_id, guest_id, check_in, check_out, state, channel, created_at, updated_at)
  VALUES ($1, $2, $3, '2029-03-29', '2029-04-03', 'confirmed', 'direct', now()::text, now()::text)`, randomUUID(), a.id, guest?.id ?? null)
  .catch(e => check('stay seeded', false, e.message));

let r = await call('GET', '/api/expenses/utility-listing?from=2029-01&to=2029-06', undefined, 'housekeeper');
check('only finance and management may see it', r.status === 403, r.status);
r = await call('GET', '/api/expenses/utility-listing?from=2029-01&to=2029-06');
check('listing loads', r.status === 200, r.text);
const j = r.json ?? {};
check('months newest first', j.months?.[0] === '2029-06' && j.months?.length === 6, JSON.stringify(j.months));
check('both units are listed, also the one with no bills', [a.id, b.id].every(id => j.units?.some(u => u.id === id)), JSON.stringify(j.units?.length));
r = await call('GET', `/api/expenses/utility-listing?from=2029-01&to=2029-06&building=${a.property_id}`);
check('one building only', r.status === 200 && r.json?.units?.length > 0 && r.json.units.every(u => u.buildingId === a.property_id) && r.json.units.some(u => u.id === a.id), r.text.slice(0, 300));
const by = Object.fromEntries((j.bills ?? []).map(x => [x.id, x]));
check('a bill on a final statement is final', by[charged]?.final === true && by[charged]?.chargeTo === 'owner', JSON.stringify(by[charged]));
check('a bill not yet deducted is not final', by[pending]?.final === false, JSON.stringify(by[pending]));
check('a company-paid bill says so', by[company]?.chargeTo !== 'owner', JSON.stringify(by[company]));
check('a record-only bill says so', by[record]?.recordOnly === true, JSON.stringify(by[record]));
check('a late bill sits in its bill month with its deduction month', by[rolled]?.billMonth === '2029-04' && by[rolled]?.deductMonth === '2029-05' && by[rolled]?.rolled === true, JSON.stringify(by[rolled]));
check('kinds are the expense categories', by[record]?.kind === 'sewerage' && by[charged]?.kind === 'electricity');
check('nights booked per month', j.nights?.[a.id]?.['2029-03'] === 3 && j.nights?.[a.id]?.['2029-04'] === 2, JSON.stringify(j.nights?.[a.id]));
r = await call('GET', `/api/expenses/utility-listing?from=2029-01&to=2029-06&unit=${b.id}`);
check('one unit only', r.json?.units?.length === 1 && r.json?.units?.[0]?.id === b.id && (r.json?.bills ?? []).length === 0, r.text.slice(0, 300));
r = await call('GET', '/api/expenses/utility-listing?from=2027-01&to=2029-06');
check('more than 24 months is refused', r.status === 422 && /24 months/.test(r.text), r.text);
r = await call('GET', '/api/expenses/utility-listing?from=2029-06&to=2029-01');
check('a range back to front is refused', r.status === 422, r.text);
r = await call('GET', '/api/expenses/utility-listing');
check('the default is the twelve months to this month', r.status === 200 && r.json?.months?.length === 12, JSON.stringify(r.json?.months));

for (const u of [a, b]) await db(`DELETE FROM expenses WHERE unit_id = $1 AND incurred_on >= '2029-01-01' AND incurred_on < '2030-01-01'`, u.id);
await db(`DELETE FROM owner_statements WHERE owner_id = $1 AND period_start = '2029-03-01'`, a.owner_id);
await db(`DELETE FROM reservations WHERE unit_id = $1 AND check_in = '2029-03-29'`, a.id);
done();
