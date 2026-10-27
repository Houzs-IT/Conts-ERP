// Late utility bills (owner, 27 Oct 2026; spec docs/superpowers/specs/2026-10-27-utility-bills-design.md §3). A bill keeps
// the month on it; when that month's owner statement is already final, the next statement that is not takes it, once,
// with "(late bill)" on its line, and the final statement does not change. A record-only bill is on no statement.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://postgres@127.0.0.1:55441/postgres API_BASE=http://localhost:8891 node scripts/api-checks/late-bills.mjs
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const next = (ym, n = 1) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

// A unit sharing its profit (its statement lists every deduction; a unit with no contract takes the default operator
// share), with no utility account numbers on file (its bills go in by unit and kind), and three months its owner has
// no statement for.
const units = await db(`SELECT u.id, u.owner_id FROM units u LEFT JOIN owner_contracts c ON c.id = u.contract_id
  WHERE u.parent_unit_id IS NULL AND coalesce(c.model, 'management') IN ('management','management_guarantee')
    AND NOT EXISTS (SELECT 1 FROM unit_utility_accounts a WHERE a.unit_id = u.id) ORDER BY u.id`);
let unit, m1;
for (const u of units) {
  const taken = new Set((await db(`SELECT substr(period_start, 1, 7) AS m FROM owner_statements WHERE owner_id = $1`, u.owner_id)).map(x => x.m));
  const first = ['2027-01', '2027-04', '2027-07', '2028-01'].find(m => ![m, next(m), next(m, 2)].some(x => taken.has(x)));
  if (first) { unit = u; m1 = first; break; }
}
check('a profit-share unit with three open months', !!unit, `${units.length} units`);
if (!unit) { done(); process.exit(1); }
const [m2, m3] = [next(m1), next(m1, 2)];
const statementFor = async (month) => (await db(`SELECT id, state FROM owner_statements WHERE owner_id = $1 AND period_start LIKE $2`, unit.owner_id, `${month}%`))[0];
const generate = (month) => call('POST', '/api/statements/generate', { period: month, ownerIds: [unit.owner_id] });
const linesOf = async (month) => { const st = await statementFor(month); if (!st) return []; const r = await call('GET', `/api/statements/${st.id}`); return r.json?.data?.lines ?? []; };
const totalOf = async (month) => (await db(`SELECT net_payout FROM owner_statements WHERE owner_id = $1 AND period_start LIKE $2`, unit.owner_id, `${month}%`))[0]?.net_payout;
// The receipt rows only (the file itself is not read here; utility-bills.mjs covers uploading one).
async function receipt(name) {
  const id = randomUUID();
  await db(`INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, unit_id, created_at)
    VALUES ($1, 'receipt', $2, 'application/pdf', 10, $3, $4, now()::text)`, id, name, `documents/${unit.id}/${id}`, unit.id);
  return id;
}

// ── The engine reads the deduction month (Task 1) ──
// Each month needs something on it for its statement to exist.
for (const m of [m1, m2, m3]) await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ($1, $2, 'other', 'Month marker', 100, 'MYR', $3, 'owner', now())`, randomUUID(), unit.id, `${m}-01`);
const seeded = randomUUID();
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, charge_to, created_at)
  VALUES ($1, $2, 'water', 'Water seeded', 1234, 'MYR', $3, $4, 'owner', now())`, seeded, unit.id, `${m1}-28`, m2);
let r = await generate(m1); check(`${m1} statement generated`, r.status < 300, r.text);
r = await generate(m2); check(`${m2} statement generated`, r.status < 300, r.text);
check('an expense is on the statement of its deduction month', (await linesOf(m2)).some(l => l.expenseId === seeded));
check('and not on the statement of its own month', !(await linesOf(m1)).some(l => l.expenseId === seeded));
await generate(m2);
check('regenerating keeps it once', (await linesOf(m2)).filter(l => l.expenseId === seeded).length === 1);
const [trig] = await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ($1, $2, 'other', 'No month given', 100, 'MYR', $3, 'owner', now()) RETURNING deduct_month`, randomUUID(), unit.id, `${m3}-05`);
check('an insert without a deduction month takes its own month', trig?.deduct_month === m3, JSON.stringify(trig));
await db(`DELETE FROM expenses WHERE id = $1`, seeded);
await generate(m2);

// ── Saving a bill for a final month (Task 2) ──
r = await call('POST', '/api/statements/finalise', { statementIds: [(await statementFor(m1)).id] });
check(`${m1} finalised`, r.status === 200, r.text);
const finalBefore = await totalOf(m1);
const doc = await receipt('late-water.pdf');
r = await call('POST', '/api/expenses/utilities', { month: m1, rows: [{ unitId: unit.id, kind: 'water', amount: 4500, receiptDocumentId: doc }] });
check('a water bill for a final month is saved', r.status === 201 && r.json?.saved >= 1, r.text);
check('the save says which month deducts it', JSON.stringify(r.json ?? {}).includes(m2), r.text);
const [late] = await db(`SELECT id, incurred_on, deduct_month, rolled FROM expenses WHERE unit_id = $1 AND category = 'water' AND incurred_on LIKE $2`, unit.id, `${m1}%`);
check('it keeps its own month and rolls its deduction', late?.deduct_month === m2 && late?.rolled === true, JSON.stringify(late));
// The m2 draft was made before the bill came: finalising it as it stands would leave the bill on no statement.
r = await call('POST', '/api/statements/finalise', { statementIds: [(await statementFor(m2)).id] });
check('a draft made before a late bill came is not finalised', r.status === 200 && r.json?.finalised === 0 && /generate/i.test(JSON.stringify(r.json?.failed ?? [])), r.text);
// The owner's cost screens agree with the statement: the bill counts where it is deducted.
const deducted = async (month) => (await call('GET', `/api/expenses/breakdown?month=${month}&unitId=${unit.id}`)).json?.units?.[0]?.totals?.deducted ?? null;
const pnlCosts = async (month) => (await call('GET', `/api/owners/${unit.owner_id}/pnl?month=${month}`)).json?.units?.find(u => u.unitId === unit.id)?.expensesTotal ?? null;
check('the costs screen counts it in the month that deducts it', (await deducted(m2)) >= 4500 && (await deducted(m1)) < 4500, `${await deducted(m1)} / ${await deducted(m2)}`);
check('so does the owner P&L', (await pnlCosts(m2)) >= 4500 && (await pnlCosts(m1)) < 4500, `${await pnlCosts(m1)} / ${await pnlCosts(m2)}`);
await generate(m2);
const lateLine = (await linesOf(m2)).find(l => l.expenseId === late?.id);
check('the next statement deducts it as a late bill', /\(late bill\)$/.test(lateLine?.description ?? ''), JSON.stringify(lateLine));
check('the final statement is unchanged', (await totalOf(m1)) === finalBefore, `${finalBefore} -> ${await totalOf(m1)}`);
r = await call('GET', `/api/expenses/utilities?month=${m1}&unitId=${unit.id}`);
check('the bills screen reads its deduction month', JSON.stringify(r.json ?? {}).includes(`"deductMonth":"${m2}"`), r.text.slice(0, 400));

r = await call('PATCH', `/api/expenses/${late?.id}`, { amount: 4600 });
check('a rolled bill can be corrected while its deduction month is open', r.status === 200, r.text);
r = await call('POST', '/api/statements/finalise', { statementIds: [(await statementFor(m2)).id] });
check(`${m2} finalised`, r.status === 200, r.text);
r = await call('PATCH', `/api/expenses/${late?.id}`, { amount: 4700 });
check('once its deduction month is final it cannot be changed', r.status === 409, r.text);
r = await call('POST', '/api/expenses/utilities', { month: m1, rows: [{ unitId: unit.id, kind: 'water', amount: 9900, receiptDocumentId: doc }] });
check('nor replaced from the bills screen', r.status >= 400 || !(r.json?.saved ?? []).length, r.text);

const doc2 = await receipt('later-water.pdf');
r = await call('POST', '/api/expenses/utilities', { month: m1, rows: [{ unitId: unit.id, kind: 'sewerage', amount: 3000, receiptDocumentId: doc2 }] });
const [twice] = await db(`SELECT deduct_month FROM expenses WHERE unit_id = $1 AND category = 'sewerage' AND incurred_on LIKE $2`, unit.id, `${m1}%`);
check('with two final months the third takes it', r.status === 201 && twice?.deduct_month === m3, `${r.status} ${JSON.stringify(twice)}`);

r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'maintenance', amount: 5000, incurredOn: `${m1}-15`, chargeTo: 'the_conts', description: 'Tap' });
check('other expenses for a final month are still refused', r.status === 409, r.text);

// ── Record only ──
const ro = randomUUID();
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, charge_to, record_only, created_at)
  VALUES ($1, $2, 'electricity', 'Electricity backfill', 7777, 'MYR', $3, $4, 'owner', true, now())`, ro, unit.id, `${m3}-28`, m3);
await generate(m3);
check('a record-only bill is on no statement', !(await linesOf(m3)).some(l => l.expenseId === ro));
check('nor counted as deducted on the costs screen', (await deducted(m3)) < 7777, String(await deducted(m3)));

// ── A rolled bill changed to another category stays with the statement that deducts it ──
const moved = randomUUID();
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, rolled, charge_to, created_at)
  VALUES ($1, $2, 'internet', 'Wi-Fi late', 5000, 'MYR', $3, $4, true, 'owner', now())`, moved, unit.id, `${m1}-20`, m3);
r = await call('PATCH', `/api/expenses/${moved}`, { category: 'other' });
check('a rolled bill can change category while its statement is open', r.status === 200, r.text);
r = await call('PATCH', `/api/expenses/${moved}`, { amount: 5100 });
check('and is still editable after that', r.status === 200, r.text);
done();
