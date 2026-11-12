// Owner statement close, part 3: GP and final (chew, 11 and 12 Nov 2026; spec
// docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md goal 7, calls 5 and 6; plan
// docs/superpowers/plans/2026-11-12-owner-report-locks-part3-final.md).
//   - Make final: refused while a step that lists one of the owner's units is not locked, the units and steps named
//     ("Waiting: …"); a unit that joins a step after the others were locked waits too; a month before the locks
//     (September 2026) is made final as before; Make final is a power given one by one.
//   - Unlock final: a reason is needed; September cannot be unlocked; final or sent with the payout pending goes back to
//     draft and the payout is cancelled (it cannot be paid, a payout run waiting for approval skips it, the payouts list
//     keeps it apart, and a fresh payout comes when the statement is sent again); a transfer under way refuses it; a paid
//     statement keeps its payout and a corrected contract posts the difference to the next open month, once; it is a
//     power given one by one.
//   - The Overall owner report: each unit's steps, locks and agent %, and each owner's final state (by whom, paid or not).
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

// ── Unlock final (spec calls 5 and 6; chew, 11 Nov 2026: "可以") ──
// The October statement is final from here on (made final above, steps all locked).
const unlockFinal = async (month, reason, role) => call('POST', '/api/statements/unlock-final', { statementId: (await statementOf(month))?.id ?? 'none', reason }, role);
const payoutsOf = () => db(`SELECT id, state, amount FROM payouts WHERE owner_id = $1 ORDER BY created_at, id`, OWNER);
const send = async month => call('POST', '/api/statements/send', { statementIds: [(await statementOf(month))?.id] });
const again = async () => { await generate(OCT); return finalise(OCT); };

r = await unlockFinal(OCT, '  ');
check('unlocking a final statement needs a reason', r.status === 422 && r.json?.error?.message === 'Say why you are unlocking.', r.text);
r = await unlockFinal(SEP, 'Check');
check('September cannot be unlocked', r.status === 409 && /September 2026/.test(r.json?.error?.message ?? ''), r.text);
r = await unlockFinal(OCT, 'Owner disputes the cleaning fee');
check('unlock final on a final statement makes it a draft', r.status === 200 && r.json?.outcome === 'draft' && r.json?.payoutCancelled === false
  && (await statementOf(OCT))?.state === 'provisional', r.text);
const why = await db(`SELECT after_state FROM audit_log WHERE action = 'statement.unlock_final' AND entity_id = $1 ORDER BY occurred_at DESC LIMIT 1`, (await statementOf(OCT))?.id);
check('… and the reason is kept in the history', JSON.stringify(why[0]?.after_state ?? '').includes('Owner disputes the cleaning fee'), JSON.stringify(why));

// Sent, its payout pending: unlocking cancels the payout; made final and sent again, a fresh payout.
r = await again();
check('made final again', r.json?.finalised === 1, r.text);
r = await send(OCT);
let pays = await payoutsOf();
check('sending makes a pending payout', r.status === 200 && r.json?.sent === 1 && pays.length === 1 && pays[0].state === 'pending', `${r.text} ${JSON.stringify(pays)}`);
r = await unlockFinal(OCT, 'Wrong owner adjustment');
pays = await payoutsOf();
check('unlock final on a sent statement cancels its payout', r.status === 200 && r.json?.outcome === 'draft' && r.json?.payoutCancelled === true
  && pays[0]?.state === 'cancelled' && (await statementOf(OCT))?.state === 'provisional', `${r.text} ${JSON.stringify(pays)}`);
r = await call('PATCH', '/api/payouts', { id: pays[0]?.id, state: 'paid' });
check('a cancelled payout cannot be marked paid', r.status === 409 && r.json?.error?.message === 'That payout was cancelled when its statement was unlocked.', r.text);
await again();
r = await send(OCT);
pays = await payoutsOf();
check('make final and send again makes a fresh pending payout', r.json?.sent === 1 && pays.length === 2 && pays[0].state === 'cancelled' && pays[1].state === 'pending', JSON.stringify(pays));
r = await call('GET', `/api/payouts?ownerId=${OWNER}`);
check('the payouts list keeps cancelled apart', r.status === 200 && r.json?.counts?.cancelled === 1 && r.json?.counts?.pending === 1
  && r.json?.outstanding === Number(pays[1].amount), r.text);

// A payout run waiting for approval: unlocking cancels the payout, and approving the run afterwards moves nothing.
await db(`INSERT INTO settings (key, value, updated_at) VALUES ('approvals.enabled', 'true', $1) ON CONFLICT (key) DO UPDATE SET value = 'true'`, now);
r = await call('POST', '/api/payouts/run', { payoutIds: [pays[1].id] }, 'finance_admin');
const runReq = r.json?.pendingApproval;
check('a payout run is sent for approval', r.status === 202 && !!runReq?.id, r.text);
r = await unlockFinal(OCT, 'Owner adjustment keyed twice');
check('… the statement can still be unlocked while the run waits', r.status === 200 && r.json?.payoutCancelled === true, r.text);
r = await call('POST', `/api/approvals/${runReq?.id}`, { decision: 'approve' });
pays = await payoutsOf();
check('an approved run skips a cancelled payout', r.status >= 400 && /still pending/.test(r.text) && pays[1]?.state === 'cancelled', `${r.text} ${JSON.stringify(pays)}`);
await call('POST', `/api/approvals/${runReq?.id}`, { decision: 'reject' });
await db(`UPDATE settings SET value = 'false' WHERE key = 'approvals.enabled'`);

// The transfer under way: unlocking waits until it is paid or has failed.
await again();
await send(OCT);
pays = await payoutsOf();
r = await call('POST', '/api/payouts/run', { payoutIds: [pays[2]?.id] });
check('a payout run starts the transfer', r.status === 200 && (await payoutsOf())[2]?.state === 'processing', r.text);
r = await unlockFinal(OCT, 'Too late');
check('a processing payout refuses unlock', r.status === 409 && r.json?.error?.message === 'The payout is being transferred. Unlock the statement once the transfer is paid or has failed.'
  && (await statementOf(OCT))?.state === 'sent', r.text);

// Paid: the paid amount stays; a contract corrected afterwards reaches the owner as an owner adjustment in the next open month.
r = await call('PATCH', '/api/payouts', { id: pays[2]?.id, state: 'paid' });
check('the payout is paid', r.status === 200 && (await statementOf(OCT))?.state === 'paid', r.text);
const [su] = await db(`SELECT payout_before_adjustments AS pba, gross_income - deductions AS net FROM statement_units WHERE statement_id = $1 AND unit_id = $2`, (await statementOf(OCT))?.id, U1);
// The unit had no contract (the default fee): a contract giving the owner 10 points more.
const fee = Number((await db(`SELECT value FROM settings WHERE key IN ('locale.managementFeePct', 'finance.default_fee_pct') ORDER BY key DESC LIMIT 1`))[0]?.value ?? 25);
await db(`INSERT INTO owner_contracts (id, owner_id, unit_id, management_fee_pct, starts_on, created_at, model, revenue_model)
  VALUES ('ocf-contract', $1, $2, $3, '2026-01-01', $4, 'management', 'management')`, OWNER, U1, fee - 10, now);
await db(`UPDATE units SET contract_id = 'ocf-contract' WHERE id = $1`, U1);
r = await unlockFinal(OCT, 'Owner share corrected to the signed agreement');
const posted = await db(`SELECT amount, occurred_on, description, state FROM owner_adjustments WHERE owner_id = $1 AND reference = $2`, OWNER, `final-unlock:${(await statementOf(OCT))?.id}`);
const company = await db(`SELECT amount, month FROM company_late_changes WHERE reference = $1`, `final-unlock:${(await statementOf(OCT))?.id}`);
const want = Math.round(Number(su?.net) * 0.1);
check('a paid statement keeps its payout and posts the difference', r.status === 200 && r.json?.outcome === 'paid'
  && (await statementOf(OCT))?.state === 'paid' && (await payoutsOf())[2]?.state === 'paid'
  && posted.length === 1 && Math.abs(Number(posted[0].amount) - want) <= 1 && String(posted[0].occurred_on).startsWith('2026-11')
  && posted[0].description === 'Change to Final Court F-01 for October 2026 after it was paid (statement unlocked)'
  && company.length === 1 && Number(company[0].amount) === -Number(posted[0].amount) && company[0].month === '2026-11', `${r.text} ${JSON.stringify({ posted, company, want })}`);
r = await unlockFinal(OCT, 'Clicked twice');
const twice = await db(`SELECT count(*)::int AS n FROM owner_adjustments WHERE owner_id = $1 AND reference LIKE 'final-unlock:%'`, OWNER);
check('a second unlock of a paid statement posts nothing', r.status === 200 && twice[0]?.n === 1, `${r.text} ${JSON.stringify(twice)}`);

// ── Unlock final is a power given one by one ──
r = await unlockFinal(OCT, 'Check', 'finance_admin');
check('without Unlock final, finance cannot unlock', r.status === 403 && r.json?.error?.message === 'Your access does not include Unlock final.', r.text);
await db(`INSERT INTO access_rules (scope, scope_id, area, level, updated_by) VALUES ('user', $1, 'unlockFinal', 'edit', 'check')
  ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = 'edit'`, FINANCE_ADMIN);
await accessCache();
r = await unlockFinal(OCT, 'Check again', 'finance_admin');
check('given Unlock final, the same person can', r.status === 200 && r.json?.outcome === 'paid', r.text);
await db(`DELETE FROM access_rules WHERE scope = 'user' AND scope_id = $1 AND area = 'unlockFinal'`, FINANCE_ADMIN);
await db(`UPDATE units SET contract_id = NULL WHERE id = $1`, U1);
await db(`DELETE FROM owner_contracts WHERE id = 'ocf-contract'`);

// ── The Overall owner report: Locks, Agent, Company and Final (part 3, spec goal 9) ──
// A contract with an agent's share (10% of GP out of the operator's share), so the unit is on the report and has an agent %.
await db(`INSERT INTO owner_contracts (id, owner_id, unit_id, management_fee_pct, agent_fee_pct, starts_on, created_at, model, revenue_model)
  VALUES ('ocf-contract2', $1, $2, $3, 10, '2026-01-01', $4, 'management', 'management')`, OWNER, U1, fee, now);
await db(`UPDATE units SET contract_id = 'ocf-contract2' WHERE id = $1`, U1);
r = await call('GET', `/api/portfolio/owner-report?month=${OCT}`);
const row1 = r.json?.rows?.find(x => x.unitId === U1);
const mine = r.json?.owners?.[OWNER];
check('the overall report carries each unit\'s steps, locks and agent %', r.status === 200 && row1?.ownerId === OWNER && row1?.agentPct === 10
  && JSON.stringify(row1?.steps) === '["income","deductions","o2"]' && JSON.stringify(row1?.locked) === '["income","deductions","o2"]', JSON.stringify(row1));
// Who made it final is the name the history recorded for the latest Make final (the account's name in this database).
const [fin] = await db(`SELECT actor_label FROM audit_log WHERE action = 'statement.finalise' AND entity_id = $1 ORDER BY occurred_at DESC LIMIT 1`, mine?.statementId ?? '');
check("… the owner's statement: final, by whom, paid, nothing waiting", mine?.state === 'final' && !!fin && mine?.by === fin.actor_label && !!mine?.at
  && mine?.waiting === null && mine?.paid === true && mine?.transferring === false && !!mine?.statementId, JSON.stringify(mine));
check('… and who may make and unlock final', r.json?.may?.makeFinal === true && r.json?.may?.unlockFinal === true && r.json?.lockFrom === '2026-10', JSON.stringify({ may: r.json?.may, lockFrom: r.json?.lockFrom }));
r = await call('GET', `/api/portfolio/owner-report?month=${SEP}`);
check('a month before the locks has no Final column to fill', r.status === 200 && r.json?.lockFrom === '2026-10', r.text.slice(0, 200));
await db(`UPDATE units SET contract_id = NULL WHERE id = $1`, U1);
await db(`DELETE FROM owner_contracts WHERE id = 'ocf-contract2'`);

// Remove everything the check made.
await dropAll();
done();
