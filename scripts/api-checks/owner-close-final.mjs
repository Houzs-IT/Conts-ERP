// Owner statement close, part 3: GP and final (chew, 11 and 12 Nov 2026; spec
// docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md goal 7, calls 5 and 6; plan
// docs/superpowers/plans/2026-11-12-owner-report-locks-part3-final.md).
//   - Make final: refused while a step that lists one of the owner's units is not locked, the units and steps named
//     ("Waiting: …"); a unit that joins a step after the others were locked waits too; a month before the locks
//     (September 2026) is made final as before; Make final is a power given one by one.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55442/postgres API_BASE=http://localhost:8788 node scripts/api-checks/owner-close-final.mjs
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const OCT = '2026-10', SEP = '2026-09';
const now = new Date().toISOString();
const FINANCE_ADMIN = '11111111-1111-4111-8111-000000000003';
// Access rules are remembered for 10 seconds per person (functions/_lib/access.ts).
const accessCache = () => new Promise(res => setTimeout(res, 11_000));

// The check's own owner, building and two units, so the checks before it in CI cannot get in its way: a share split with
// no contract (the default fee), no misc charge. A local rerun starts from a clean slate.
const OWNER = 'ocf-owner', PROP = 'ocf-prop', U1 = 'ocf-u1', U2 = 'ocf-u2';
const dropAll = async () => {
  const ofOwner = 'SELECT id FROM units WHERE owner_id = $1';
  await db(`DELETE FROM payouts WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM statement_lines WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM statement_units WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM owner_statements WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM owner_adjustments WHERE owner_id = $1`, OWNER);
  for (const table of ['company_late_changes', 'owner_report_locks', 'expenses']) await db(`DELETE FROM ${table} WHERE unit_id IN (${ofOwner})`, OWNER);
  await db(`UPDATE units SET contract_id = NULL WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM owner_contracts WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM units WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM properties WHERE id = $1`, PROP);
  await db(`DELETE FROM owners WHERE id = $1`, OWNER);
  await db(`DELETE FROM access_rules WHERE scope = 'user' AND scope_id = $1 AND area IN ('makeFinal', 'unlockFinal')`, FINANCE_ADMIN);
};
await dropAll();
await db(`INSERT INTO owners (id, display_name, email, created_at, updated_at) VALUES ($1, 'Final Check Owner', 'final-check-owner@example.invalid', $2, $2)`, OWNER, now);
// Bank details on file, so a sent statement's payout starts as pending and can join a payout run.
await db(`UPDATE owners SET bank_name = 'Check Bank', bank_account_last4 = '4321' WHERE id = $1`, OWNER);
await db(`INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES ($1, 'Final Court', 'Check', 'Check', 'Check', $2, $2)`, PROP, now);
await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, misc_charges, created_at, updated_at)
  VALUES ($1, $3, $4, 'F-01', 0, 0, $5, $5), ($2, $3, $4, 'F-02', 0, 0, $5, $5)`, U1, U2, PROP, OWNER, now);
// U1 has an October and a September cost (so it is on every step of both months); U2 has nothing yet.
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ('ocf-c-oct', $1, 'other', 'Check: October cost', 12000, 'MYR', '2026-10-10', 'owner', $2),
         ('ocf-c-sep', $1, 'other', 'Check: September cost', 5000, 'MYR', '2026-09-12', 'owner', $2)`, U1, now);

const lock = (stage, unitIds, role) => call('POST', '/api/owner-close/lock', { month: OCT, stage, unitIds }, role);
const generate = month => call('POST', '/api/statements/generate', { period: month, ownerIds: [OWNER] });
const statementOf = async month => (await db(`SELECT id, state FROM owner_statements WHERE owner_id = $1 AND period_start = $2`, OWNER, `${month}-01`))[0];
const finalise = async (month, role) => call('POST', '/api/statements/finalise', { statementIds: [(await statementOf(month))?.id ?? 'none'] }, role);
const LOCK_FIRST = 'Lock every step on Owner statement close before marking it final.';

let r = await generate(OCT);
check('the October draft is made', r.status < 300 && !!(await statementOf(OCT)), r.text);
r = await lock('income', [U1]);
const r2 = await lock('deductions', [U1]);
check('income and deductions locked', r.status < 300 && r.json?.locked?.includes(U1) && r2.status < 300 && r2.json?.locked?.includes(U1), `${r.text} | ${r2.text}`);

// ── Make final waits for every step ──
r = await finalise(OCT);
check('finalise refuses while a step is open', r.status === 200 && r.json?.finalised === 0 && r.json?.failed?.[0]?.reason === `Waiting: O2. ${LOCK_FIRST}`, r.text);
check('… and the statement stays a draft', (await statementOf(OCT))?.state === 'provisional');

// A second unit joins the O2 step after the first unit's steps were all locked: its owner adjustment is on the draft.
r = await lock('o2', [U1]);
check('O2 locked for the first unit', r.status < 300 && r.json?.locked?.includes(U1), r.text);
await db(`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
  VALUES ('ocf-a-u2', $1, $2, 'credit', 500, 'Check: October credit on the second unit', '2026-10-15', NULL, 'open', 'manual', NULL, $3, $3)`, OWNER, U2, now);
await generate(OCT);
r = await finalise(OCT);
// A unit with something on the statement is on every step its contract has (closeSteps), so all three wait.
check('a unit that joins the steps after the locks is waiting', r.status === 200 && r.json?.finalised === 0
  && r.json?.failed?.[0]?.reason === `Waiting: F-02 income, deductions and O2. ${LOCK_FIRST}`, r.text);

for (const stage of ['income', 'deductions', 'o2']) {
  r = await lock(stage, [U2]);
  check(`${stage} locked for the second unit`, r.status < 300 && r.json?.locked?.includes(U2), r.text);
}
await generate(OCT);
r = await finalise(OCT);
check('finalise passes once every step is locked', r.status === 200 && r.json?.finalised === 1, r.text);
check('… and the statement is final', (await statementOf(OCT))?.state === 'finalised');

// ── A month before the locks keeps today's Make final ──
r = await generate(SEP);
check('the September draft is made', r.status < 300 && !!(await statementOf(SEP)), r.text);
r = await finalise(SEP);
check("September keeps today's finalise", r.status === 200 && r.json?.finalised === 1, r.text);

// ── Make final is a power given one by one ──
r = await finalise(OCT, 'finance_admin');
check('without Make final, finance cannot mark a statement final', r.status === 403 && r.json?.error?.message === 'Your access does not include Make final.', r.text);
await db(`INSERT INTO access_rules (scope, scope_id, area, level, updated_by) VALUES ('user', $1, 'makeFinal', 'edit', 'check')
  ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = 'edit'`, FINANCE_ADMIN);
await accessCache();
r = await finalise(OCT, 'finance_admin');
check('given Make final, the same person can', r.status === 200 && r.json?.failed?.[0]?.reason === 'Only a draft statement can be marked final.', r.text);
await db(`DELETE FROM access_rules WHERE scope = 'user' AND scope_id = $1 AND area = 'makeFinal'`, FINANCE_ADMIN);

// Remove everything the check made.
await dropAll();
done();
