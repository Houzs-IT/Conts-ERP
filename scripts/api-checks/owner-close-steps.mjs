// Owner statement close: the cost locks and O2 (chew, 12 Nov 2026, part 2a; split into Cleaning, Utilities, Add. ded.
// and Misc on 13 Nov 2026: docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md). A locked category never
// changes; what comes later lands in the next open month and the person who adds it is told so:
//   - Add. ded. (other deductions): lock, lock again (a no-op); a new cost for the month goes on November, however it is
//     written; a changed cost keeps the month as locked and posts the difference; a locked cost cannot be removed;
//   - Misc: stays as locked when reservations change, its difference posted by the misc lock; each lock carries its own
//     part when Revenue is locked too; unlocking brings the month back;
//   - Utilities: locked alone, a cleaning charge still lands in October while a bill rolls to November; a bill that would
//     replace a locked one is left alone;
//   - Cleaning: a cost re-categorised from a locked category to an open one is counted once (review focus 1);
//   - a new cost rolls past a final November; a cost moved out of the month leaves it as locked;
//   - O2: lock; a new owner adjustment for the month is dated November; a locked one cannot be held, settled, deleted
//     or released into the month; October's statement prints only what was locked; an adjustment with no unit follows
//     the owner's first unit; a late difference skips a month whose O2 is locked;
//   - the Lock deductions and Lock O2 powers.
// The month's figures are read from its draft statement, generated again where needed: what the locks protect.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55442/postgres API_BASE=http://localhost:8788 node scripts/api-checks/owner-close-steps.mjs
import postgres from 'postgres';
import { call, check, done, receiptFor } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const OCT = '2026-10', NOV = '2026-11';
const now = new Date().toISOString();
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1;
const ymd = d => String(d).slice(0, 10);

let r = await call('GET', `/api/owner-close/summary?month=${OCT}`);
check('the month reads', r.status === 200 && !!r.json?.counts?.additional, r.text.slice(0, 300));
if (r.status !== 200) done();

// The check's own owner, building and unit, so the checks before it in CI (which use or finalise every demo unit)
// cannot get in its way: a share split with no contract (the default fee), the misc charge on, nothing in October yet.
// A local rerun starts from a clean slate.
const OWNER = 'ocs-owner', PROP = 'ocs-prop', UNIT = 'ocs-u';
const dropAll = async () => {
  const ofOwner = 'SELECT id FROM units WHERE owner_id = $1';
  await db(`DELETE FROM expenses WHERE id LIKE 'ocs-%'`);
  await db(`DELETE FROM owner_adjustments WHERE id LIKE 'ocs-%'`);
  await db(`DELETE FROM statement_lines WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM statement_units WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM owner_statements WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM owner_adjustments WHERE owner_id = $1`, OWNER);
  // company_late_changes: the company's share of the locks' late differences (part 2b, migration 0308).
  for (const table of ['company_late_changes', 'owner_report_locks', 'expenses', 'unit_utility_accounts', 'reservations', 'documents']) await db(`DELETE FROM ${table} WHERE unit_id IN (${ofOwner})`, OWNER);
  await db(`DELETE FROM units WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM properties WHERE id IN ($1, 'ocs-p0')`, PROP);
  await db(`DELETE FROM owners WHERE id = $1`, OWNER);
};
const dropUnit2 = async () => {
  await db(`DELETE FROM statement_lines WHERE unit_id = 'ocs-u2'`);
  await db(`DELETE FROM statement_units WHERE unit_id = 'ocs-u2'`);
  await db(`DELETE FROM units WHERE id = 'ocs-u2'`);
  await db(`DELETE FROM properties WHERE id = 'ocs-p0'`);
};
await dropAll();
await db(`INSERT INTO owners (id, display_name, email, created_at, updated_at) VALUES ($1, 'Check Owner', 'check-owner@example.invalid', $2, $2)`, OWNER, now);
await db(`INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES ($1, 'Check Court', 'Check', 'Check', 'Check', $2, $2)`, PROP, now);
await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, misc_charges, created_at, updated_at) VALUES ($1, $2, $3, 'C-01', 0, 1, $4, $4)`, UNIT, PROP, OWNER, now);
const [u] = await db(`SELECT u.id, u.owner_id, u.contract_id, u.split_kind, u.split_value, u.unit_number, p.name AS property_name
  FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = $1`, UNIT);
check('the check has its own owner and unit', !!u, 'not created');
if (!u) done();
const day = n => new Date(Date.UTC(2026, 9, n)).toISOString().slice(0, 10); // day(1) = 1 Oct
const win = { s1: 2, s2: 10 }; // 2–7 Oct and 10–13 Oct: the unit has nothing else

const label = `${u.property_name} ${u.unit_number}`;
const settings = Object.fromEntries((await db(`SELECT key, value FROM settings WHERE key IN ('locale.managementFeePct', 'finance.default_fee_pct', 'report.miscChargeMonthly')`)).map(s => [s.key, s.value]));
const defaultFee = Number(settings['locale.managementFeePct'] ?? settings['finance.default_fee_pct'] ?? 25);
const pct = 100 - defaultFee; // no contract and no split: the default fee
const miscMonthly = Number(settings['report.miscChargeMonthly'] ?? 10000);
const misc = nights => Math.round(miscMonthly * Math.min(1, nights / 31));
const owner = share => Math.round((share * pct) / 100);

// The fixture: an October cost, an October cleaning charge, an October owner credit and a held September debt.
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ('ocs-c0', $1, 'other', 'Check: October cost', 12000, 'MYR', '2026-10-10', 'owner', $2),
         ('ocs-cl1', $1, 'cleaning', 'Check: October clean', 8000, 'MYR', '2026-10-12', 'owner', $2)`, u.id, now);
await db(`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
  VALUES ('ocs-a0', $1, $2, 'credit', 3000, 'Check: October credit', '2026-10-05', NULL, 'open', 'manual', NULL, $3, $3),
         ('ocs-h0', $1, $2, 'charge', -1000, 'Check: held September debt', '2026-09-15', NULL, 'held', 'manual', NULL, $3, $3)`, u.owner_id, u.id, now);
// A second unit of the owner, listed after u (same building, its unit number extended), and an owner adjustment with no
// unit: the statement puts it on the owner's first unit, u.
await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at) VALUES ('ocs-u2', $1, $2, $3, 0, $4, $4)`,
  PROP, u.owner_id, `${u.unit_number}-zz`, now);
await db(`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
  VALUES ('ocs-n0', $1, NULL, 'credit', 700, 'Check: October credit with no unit', '2026-10-04', NULL, 'open', 'manual', NULL, $2, $2)`, u.owner_id, now);
const firstUnit = async () => (await db(`SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.owner_id = $1 ORDER BY p.name, u.unit_number LIMIT 1`, u.owner_id))[0]?.id;
check("u is its owner's first unit", (await firstUnit()) === u.id, String(await firstUnit()));
const receipt = await receiptFor(u.id);
await db(`INSERT INTO unit_utility_accounts (id, unit_id, kind, account_no, provider, created_at, updated_at)
  VALUES ('ocs-acc-w', $1, 'water', 'OCS-W1', 'Check water', $2, $2), ('ocs-acc-e', $1, 'electricity', 'OCS-E1', 'Check power', $2, $2),
         ('ocs-acc-i', $1, 'internet', 'OCS-I1', 'Check internet', $2, $2)`, u.id, now);
r = await call('POST', '/api/expenses/utilities', { month: OCT, rows: [{ accountId: 'ocs-acc-w', amount: 2000, receiptDocumentId: receipt }] });
check('an October water bill before the lock is deducted in October', r.status === 201 && r.json?.saved >= 1, r.text);
r = await call('POST', '/api/expenses/utilities', { month: OCT, rows: [{ accountId: 'ocs-acc-i', amount: 1500, receiptDocumentId: receipt, ownerPaid: true }] });
check('an October internet bill the owner paid gives the owner a credit in October', r.status === 201 && r.json?.saved >= 1, r.text);
// Review finding 3: an expense written from a session without pos on its search path (a data fix through the database
// connector) still works; the lock check is skipped there, it does not fail the write.
{
  // SET LOCAL inside its own transaction: the local PGlite database runs one session for every connection.
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  let err = null;
  try { await c.begin(async sql => { await sql.unsafe('SET LOCAL search_path = public'); await sql.unsafe(`INSERT INTO pos.expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at) VALUES ('ocs-public', $1, 'other', 'Check: written from public', 100, 'MYR', '2026-09-05', 'the_conts', $2)`, [u.id, now]); }); }
  catch (e) { err = e.message; } finally { await c.end({ timeout: 5 }); }
  check('an expense written from a session without pos on its search path still works', err === null, err);
  await db(`DELETE FROM expenses WHERE id = 'ocs-public'`);
}

const lock = (stage, unitIds, role) => call('POST', '/api/owner-close/lock', { month: OCT, stage, unitIds }, role);
const unlock = (stage, unitId) => call('POST', '/api/owner-close/unlock', { month: OCT, stage, unitIds: [unitId] });
const generate = (month, ownerId) => call('POST', '/api/statements/generate', { period: month, ownerIds: [ownerId] });
/** October as its draft statement takes it (generated again first): the unit's nights, and each category's total in sen. */
const october = async () => {
  await generate(OCT, u.owner_id);
  const [su] = await db(`SELECT su.nights FROM statement_units su JOIN owner_statements s ON s.id = su.statement_id
    WHERE s.owner_id = $1 AND s.period_start = '2026-10-01' AND su.unit_id = $2`, u.owner_id, u.id);
  const lines = await db(`SELECT l.category, sum(l.amount)::int AS amount FROM statement_lines l JOIN owner_statements s ON s.id = l.statement_id
    WHERE s.owner_id = $1 AND s.period_start = '2026-10-01' AND l.unit_id = $2 AND l.line_type <> 'adjustment' GROUP BY l.category`, u.owner_id, u.id);
  const sum = pick => -lines.filter(x => pick(String(x.category))).reduce((n, x) => n + Number(x.amount), 0);
  return {
    nights: Number(su?.nights ?? 0),
    cleaning: sum(c => c.startsWith('cleaning')), utilities: sum(c => ['electricity', 'water', 'internet', 'sewerage'].includes(c)),
    additional: sum(c => c === 'additional'), misc: sum(c => c === 'misc'),
  };
};
// October's draft first, as finance does: it takes the month's open owner adjustments (a later month's draft would
// otherwise take them).
r = await generate(OCT, u.owner_id);
check("October's draft is generated", r.status < 300, r.text);
const lateOf = (unitId, name) => db(`SELECT id, amount, occurred_on, state, description FROM owner_adjustments
  WHERE unit_id = $1 AND source = 'stage_lock' AND description LIKE $2 ORDER BY occurred_on, id`, unitId, `% ${name} for %`);
const f0 = await october();
const n0 = f0.nights;
check('October reads from its draft', f0.additional === 12000 && f0.cleaning === 8000 && f0.utilities >= 2000, JSON.stringify(f0));

// ── Add. ded. (other deductions) ──
r = await lock('additional', [u.id]);
check('other deductions can be locked', r.status === 201 && r.json?.locked?.length === 1 && r.json.locked[0] === u.id, r.text);
r = await lock('additional', [u.id]);
check('… and locking again changes nothing', r.status === 200 && !r.json?.locked?.length && !!r.json?.already?.includes(u.id), r.text);
r = await call('GET', `/api/owner-close/summary?month=${OCT}`);
check('the summary counts the lock', (r.json?.counts?.additional?.locked ?? 0) >= 1, r.text.slice(0, 300));
const add0 = (await october()).additional;

r = await call('POST', '/api/expenses', { unitId: u.id, category: 'other', description: 'Check: late cost', amount: 5000, incurredOn: '2026-10-20', chargeTo: 'owner' });
const d3 = (await db(`SELECT deduct_month, rolled FROM expenses WHERE description = 'Check: late cost'`))[0];
check('a new cost on a locked month goes on the next open one',
  r.status === 201 && d3?.deduct_month === NOV && d3?.rolled === true
    && r.json?.notice === `October 2026 other deductions are locked for ${label}. This cost goes on the November 2026 statement.`, `${r.text} ${JSON.stringify(d3)}`);
check('the locked month keeps its other deductions', (await october()).additional === add0, String(add0));
const [d5] = await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ('ocs-c5', $1, 'other', 'Check: written straight in', 700, 'MYR', '2026-10-21', 'owner', $2) RETURNING deduct_month`, u.id, now);
check('a cost written straight into the table moves too', d5?.deduct_month === NOV, JSON.stringify(d5));

r = await call('PATCH', '/api/expenses/ocs-c0', { amount: 15000 });
check('editing a locked cost is allowed and says where the difference goes', r.status === 200
  && r.json?.notice === `October 2026 other deductions are locked for ${label}. The October 2026 statement keeps the old amount; the difference goes to the next open month as an owner adjustment.`, r.text);
check('… and the month keeps the locked amount', (await october()).additional === add0, String(add0));
await generate(NOV, u.owner_id);
let add = await lateOf(u.id, 'other deductions');
check('… and its difference reaches November once', add.length === 1 && ymd(add[0].occurred_on) === '2026-11-01' && near(add[0].amount, -owner(3000))
  && add[0].description === `Late change to ${label} other deductions for October 2026 (other deductions locked)`, JSON.stringify(add));

r = await call('DELETE', '/api/expenses/ocs-c0');
check('a locked cost cannot be removed', r.status === 409
  && r.json?.error?.message === `October 2026 other deductions are locked for ${label}. Ask someone who can unlock a step to unlock them first.`, r.text);

// ── Misc: locked on its own, its difference posted by its own lock ──
r = await lock('misc', [u.id]);
check('misc can be locked on its own', r.status === 201, r.text);
const S1 = 'ocs-s1', S2 = 'ocs-s2';
await db(`INSERT INTO reservations (id, unit_id, channel, external_ref, state, check_in, check_out, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
  VALUES ($1, $2, 'direct', $1, 'checked_out', $3, $4, 50000, 0, 50000, $5, $5)`, S1, u.id, day(win.s1), day(win.s1 + 5), now);
check('the misc charge stays as locked when a reservation is added', (await october()).misc === misc(n0), String(misc(n0)));
await generate(NOV, u.owner_id);
let msc = await lateOf(u.id, 'misc');
const dMisc5 = misc(n0 + 5) - misc(n0);
check('… and its difference is posted by the misc lock', msc.length === 1 && near(msc[0].amount, -owner(dMisc5))
  && (await lateOf(u.id, 'other deductions')).length === 1, `${JSON.stringify(msc)} want ${-owner(dMisc5)}`);

r = await lock('income', [u.id]);
check('income is locked too', r.status === 201, r.text);
await db(`INSERT INTO reservations (id, unit_id, channel, external_ref, state, check_in, check_out, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
  VALUES ($1, $2, 'direct', $1, 'checked_out', $3, $4, 30000, 0, 30000, $5, $5)`, S2, u.id, day(win.s2), day(win.s2 + 3), now);
await generate(NOV, u.owner_id);
let inc = await lateOf(u.id, 'income');
add = await lateOf(u.id, 'other deductions');
msc = await lateOf(u.id, 'misc');
const dMisc8 = misc(n0 + 8) - misc(n0);
// Revenue, then the cost categories, then misc: each lock carries the change in its own part.
check('with income locked too, each lock carries its own part',
  inc.length === 1 && near(inc[0].amount, owner(30000)) && add.length === 1 && near(add[0].amount, -owner(3000)) && msc.length === 1 && near(msc[0].amount, -owner(dMisc8)),
  `income ${JSON.stringify(inc)} want ${owner(30000)}; other ${JSON.stringify(add)} want ${-owner(3000)}; misc ${JSON.stringify(msc)} want ${-owner(dMisc8)}`);

r = await unlock('income', u.id);
await generate(NOV, u.owner_id);
inc = await lateOf(u.id, 'income');
msc = await lateOf(u.id, 'misc');
check('unlocking income, with no reason, leaves the misc difference with the misc lock', r.status === 200 && (r.json?.unlocked ?? []).includes(u.id)
  && inc.length === 0 && msc.length === 1 && near(msc[0].amount, -owner(dMisc8)), `${r.text} ${JSON.stringify(inc)} ${JSON.stringify(msc)}`);

r = await unlock('additional', u.id);
const r2 = await unlock('misc', u.id);
const back = await october();
check('unlocking other deductions and misc brings the month back', r.status === 200 && r2.status === 200
  && (await lateOf(u.id, 'other deductions')).length === 0 && (await lateOf(u.id, 'misc')).length === 0
  && back.additional === add0 + 3000 && back.misc === misc(n0 + 8), `${r.text} ${r2.text} ${JSON.stringify(back)} want ${add0 + 3000} and ${misc(n0 + 8)}`);

// ── Utilities locked alone: a cleaning charge still lands in October; a bill rolls ──
r = await lock('utilities', [u.id]);
check('utilities can be locked', r.status === 201, r.text);
r = await call('POST', '/api/expenses', { unitId: u.id, category: 'cleaning', description: 'Check: clean while utilities are locked', amount: 6500, incurredOn: '2026-10-22', chargeTo: 'owner' });
const cl2 = (await db(`SELECT deduct_month, rolled FROM expenses WHERE description = 'Check: clean while utilities are locked'`))[0];
check('a cleaning charge is not held back by the utilities lock', r.status === 201 && cl2?.deduct_month === OCT && cl2?.rolled === false && !r.json?.notice,
  `${r.text} ${JSON.stringify(cl2)}`);
r = await call('POST', '/api/expenses/utilities', { month: OCT, rows: [{ accountId: 'ocs-acc-e', amount: 4000, receiptDocumentId: receipt }] });
const elec = (await db(`SELECT deduct_month, rolled FROM expenses WHERE reference = 'OCS-E1' AND incurred_on LIKE '2026-10%'`))[0];
check("utility bills: a locked month's bill rolls", r.status === 201 && elec?.deduct_month === NOV && elec?.rolled === true, `${r.text} ${JSON.stringify(elec)}`);
r = await call('POST', '/api/expenses/utilities', { month: OCT, rows: [{ accountId: 'ocs-acc-w', amount: 2500, receiptDocumentId: receipt }] });
const water = await db(`SELECT amount, deduct_month FROM expenses WHERE reference = 'OCS-W1' AND incurred_on LIKE '2026-10%'`);
check('… and a bill that would replace a locked one is left alone', r.status === 201 && (r.json?.locked ?? []).includes('OCS-W1')
  && water.length === 1 && Number(water[0].amount) === 2000, `${r.text} ${JSON.stringify(water)}`);

// ── Cleaning: a cost re-categorised from a locked category to an open one is counted once (review focus 1) ──
r = await lock('cleaning', [u.id]);
const fc = await october();
check('cleaning can be locked', r.status === 201 && fc.cleaning === 8000 + 6500, `${r.text} ${JSON.stringify(fc)}`);
await db(`UPDATE expenses SET category = 'other' WHERE id = 'ocs-cl1'`);
const fe = await october();
await generate(NOV, u.owner_id);
check('a cost moved from locked cleaning to open other deductions is counted once, under cleaning, and posts nothing late',
  fe.cleaning === fc.cleaning && fe.additional === fc.additional && (await lateOf(u.id, 'cleaning')).length === 0, `${JSON.stringify(fc)} -> ${JSON.stringify(fe)}`);
// Final review I2: what a lock keeps decides removal, whatever the cost's category is now (spec goal 2). The clean the
// cleaning lock keeps, now under open other deductions, still cannot be removed.
r = await call('DELETE', '/api/expenses/ocs-cl1');
check('a cost a lock keeps cannot be removed after it moves to an open category', r.status === 409
  && r.json?.error?.message === `October 2026 cleaning is locked for ${label}. Ask someone who can unlock a step to unlock it first.`, r.text);
// Open → locked: a cost under open other deductions moved into locked cleaning is told that the month keeps its old
// figures (its difference goes on as a late change); no lock keeps it, so it can still be removed.
r = await call('POST', '/api/expenses', { unitId: u.id, category: 'other', description: 'Check: becomes a clean', amount: 1000, incurredOn: '2026-10-20', chargeTo: 'owner' });
const bc = (await db(`SELECT id, deduct_month FROM expenses WHERE description = 'Check: becomes a clean'`))[0];
check('a cost for open other deductions stays in October', r.status === 201 && bc?.deduct_month === OCT, `${r.text} ${JSON.stringify(bc)}`);
r = await call('PATCH', `/api/expenses/${bc?.id}`, { category: 'cleaning' });
check('moving it into locked cleaning says the month keeps its old figures', r.status === 200
  && r.json?.notice === `October 2026 cleaning is locked for ${label}. The October 2026 statement keeps the old amount; the difference goes to the next open month as an owner adjustment.`, r.text);
r = await call('DELETE', `/api/expenses/${bc?.id}`);
check('… and, as no lock keeps it, it can be removed', r.status === 200, r.text);

// ── Add. ded. locked again: a cost for October skips a final November; a cost moved out leaves October as locked ──
r = await lock('additional', [u.id]);
const add1 = (await october()).additional;
check('locked again, other deductions keep what they hold and not the cost cleaning keeps', r.status === 201 && add1 === fe.additional, `${r.text} ${add1} vs ${fe.additional}`);
await db(`UPDATE owner_statements SET state = 'finalised', finalised_at = $2 WHERE owner_id = $1 AND period_start = '2026-11-01'`, u.owner_id, now);
r = await call('POST', '/api/expenses', { unitId: u.id, category: 'other', description: 'Check: past a final month', amount: 600, incurredOn: '2026-10-25', chargeTo: 'owner' });
const d12 = (await db(`SELECT deduct_month FROM expenses WHERE description = 'Check: past a final month'`))[0];
check('a new cost rolls past a final month too', r.status === 201 && d12?.deduct_month === '2026-12'
  && r.json?.notice === `October 2026 other deductions are locked for ${label}. This cost goes on the December 2026 statement.`, `${r.text} ${JSON.stringify(d12)}`);
await db(`UPDATE owner_statements SET state = 'provisional', finalised_at = NULL WHERE owner_id = $1 AND period_start = '2026-11-01'`, u.owner_id);
r = await call('PATCH', '/api/expenses/ocs-c0', { incurredOn: '2026-11-05' });
await generate(NOV, u.owner_id);
add = await lateOf(u.id, 'other deductions');
const cln = await lateOf(u.id, 'cleaning');
// Each lock carries its own part: the clean re-categorised above (kept by the cleaning lock, live under other deductions
// now) leaves cleaning (+RM 80 of costs gone there) and arrives in other deductions, where the moved cost leaves too
// (RM 150 - RM 80). Together: the RM 150 the month no longer has.
check('a locked cost moved out of the month leaves the month as locked; each lock posts its own part', r.status === 200 && (await october()).additional === add1
  && add.length === 1 && near(add[0].amount, owner(7000)) && cln.length === 1 && near(cln[0].amount, owner(8000)),
  `${r.text} other ${JSON.stringify(add)} want ${owner(7000)}; cleaning ${JSON.stringify(cln)} want ${owner(8000)}`);

// ── O2 ──
await db(`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
  VALUES ('ocs-a1', $1, $2, 'credit', 400, 'Check: October credit on no draft yet', '2026-10-06', NULL, 'open', 'manual', NULL, $3, $3)`, u.owner_id, u.id, now);
r = await lock('o2', [u.id]);
const kept = (await db(`SELECT frozen FROM owner_report_locks WHERE unit_id = $1 AND month = $2 AND stage = 'o2'`, u.id, OCT))[0]?.frozen;
{
  await generate(NOV, u.owner_id);
  const onNov = await db(`SELECT l.adjustment_id FROM statement_lines l JOIN owner_statements s ON s.id = l.statement_id WHERE s.owner_id = $1 AND s.period_start = '2026-11-01' AND l.adjustment_id = 'ocs-a1'`, u.owner_id);
  const row = (await db(`SELECT statement_id FROM owner_adjustments WHERE id = 'ocs-a1'`))[0];
  const nov = (await db(`SELECT id FROM owner_statements WHERE owner_id = $1 AND period_start = '2026-11-01'`, u.owner_id))[0]?.id;
  check("November's statement does not take what October's O2 lock kept", (kept?.adjustments ?? []).some(a => a.id === 'ocs-a1') && onNov.length === 0 && row?.statement_id !== nov,
    `${JSON.stringify(onNov)} ${JSON.stringify(row)}`);
}
check('O2 can be locked', r.status === 201 && (kept?.adjustments ?? []).some(a => a.id === 'ocs-a0'), `${r.text} ${JSON.stringify(kept)}`);
r = await call('POST', `/api/owners/${u.owner_id}/adjustments`, { kind: 'credit', amount: 2500, description: 'Check: late O2', occurredOn: '2026-10-15', unitId: u.id });
const o2 = (await db(`SELECT id, occurred_on FROM owner_adjustments WHERE description = 'Check: late O2'`))[0];
check('a new owner adjustment for a locked month is dated into the next open one', r.status === 201 && ymd(o2?.occurred_on) === '2026-11-01'
  && r.json?.notice === `October 2026 O2 is locked for ${label}. This owner adjustment is dated November 2026.`, `${r.text} ${JSON.stringify(o2)}`);
const REFUSED = `October 2026 O2 is locked for ${label}. Ask someone who can unlock a step to unlock it first.`;
const hold = await call('PATCH', `/api/owners/${u.owner_id}/adjustments/ocs-a0`, { action: 'hold' });
const settle = await call('PATCH', `/api/owners/${u.owner_id}/adjustments/ocs-a0`, { action: 'settle', note: 'Check' });
const del = await call('DELETE', `/api/owners/${u.owner_id}/adjustments/ocs-a0`);
check('a locked owner adjustment cannot be held, settled or deleted',
  [hold, settle, del].every(x => x.status === 409 && x.json?.error?.message === REFUSED), [hold, settle, del].map(x => x.text).join(' | '));
r = await call('PATCH', `/api/owners/${u.owner_id}/adjustments/ocs-h0`, { action: 'release', month: OCT });
check('nothing is released into a locked month', r.status === 409 && r.json?.error?.message === `${REFUSED} Release it into November 2026 instead.`, r.text);
r = await call('PATCH', `/api/owners/${u.owner_id}/adjustments/ocs-h0`, { action: 'release', month: NOV });
check('… and it can be released into November', r.status === 200, r.text);

const adjLines = async month => (await db(`SELECT l.adjustment_id FROM statement_lines l JOIN owner_statements s ON s.id = l.statement_id
  WHERE s.owner_id = $1 AND s.period_start = $2 AND l.unit_id = $3 AND l.adjustment_id IS NOT NULL ORDER BY 1`, u.owner_id, `${month}-01`, u.id)).map(x => x.adjustment_id);
await generate(OCT, u.owner_id);
const octAdj = await adjLines(OCT);
await generate(NOV, u.owner_id);
const novAdj = await adjLines(NOV);
const keptIds = (kept?.adjustments ?? []).map(a => a.id).sort();
check("October's statement keeps its locked O2", octAdj.includes('ocs-a0') && JSON.stringify(octAdj) === JSON.stringify(keptIds)
  && novAdj.includes(o2?.id) && novAdj.includes('ocs-h0') && !octAdj.includes(o2?.id) && !octAdj.includes('ocs-h0'),
  `October ${JSON.stringify(octAdj)} kept ${JSON.stringify(keptIds)} November ${JSON.stringify(novAdj)}`);

const noUnit = await call('POST', `/api/owners/${u.owner_id}/adjustments`, { kind: 'charge', amount: 1500, description: 'Check: no unit', occurredOn: '2026-10-20' });
const nu = (await db(`SELECT occurred_on FROM owner_adjustments WHERE description = 'Check: no unit'`))[0];
check("an owner adjustment with no unit is dated past the first unit's locked O2", noUnit.status === 201 && ymd(nu?.occurred_on) === '2026-11-01',
  `${noUnit.text} ${JSON.stringify(nu)}`);
// The second unit becomes the owner's first (a building that sorts first): the locked no-unit credit stays on u and is
// not printed twice.
await db(`INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES ('ocs-p0', '0000 Check', 'Check', 'Check', 'Check', $1, $1)`, now);
await db(`UPDATE units SET property_id = 'ocs-p0' WHERE id = 'ocs-u2'`);
await generate(OCT, u.owner_id);
const n0Lines = await db(`SELECT l.unit_id FROM statement_lines l JOIN owner_statements s ON s.id = l.statement_id
  WHERE s.owner_id = $1 AND s.period_start = '2026-10-01' AND l.adjustment_id = 'ocs-n0'`, u.owner_id);
check('… and once locked it stays on u, printed once', (await firstUnit()) === 'ocs-u2' && n0Lines.length === 1 && n0Lines[0].unit_id === u.id,
  `${await firstUnit()} ${JSON.stringify(n0Lines)}`);
await dropUnit2();

// A late difference skips a month whose O2 is locked. November cannot be locked through the route until it ends, so
// its O2 lock is written here, keeping what November's statement takes for u today.
r = await lock('income', [u.id]);
const novId = (await db(`SELECT id FROM owner_statements WHERE owner_id = $1 AND period_start = '2026-11-01'`, u.owner_id))[0]?.id ?? null;
const novKeeps = await db(`SELECT id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, statement_id FROM owner_adjustments
  WHERE unit_id = $1 AND state = 'open' AND occurred_on < '2026-12-01' AND (statement_id IS NULL OR statement_id = $2)`, u.id, novId);
await db(`INSERT INTO owner_report_locks (id, month, unit_id, stage, frozen, locked_by, locked_by_name, locked_at) VALUES ('ocs-o2-nov', $1, $2, 'o2', $3, 'check', 'Check', $4)`,
  NOV, u.id, JSON.stringify({ adjustments: novKeeps }), now);
const addOnNov = (await lateOf(u.id, 'other deductions'))[0];
await db(`UPDATE reservations SET gross_booking_value = gross_booking_value + 5000, collected_revenue = collected_revenue + 5000 WHERE id = $1`, S1);
await generate(NOV, u.owner_id);
inc = await lateOf(u.id, 'income');
add = await lateOf(u.id, 'other deductions');
check('a late difference skips a locked O2 month', r.status === 201 && inc.length === 1 && ymd(inc[0].occurred_on) === '2026-12-01' && near(inc[0].amount, owner(5000))
  && add.length === 1 && add[0].id === addOnNov?.id && ymd(add[0].occurred_on) === '2026-11-01', `${r.text} ${JSON.stringify(inc)} ${JSON.stringify(add)}`);

// Review finding 2: re-entering the owner-paid internet bill would delete its owner line, which October's O2 lock
// keeps (October could then never be marked final). Utilities are unlocked first, so only the O2 lock stands in the way.
{
  await unlock('utilities', u.id);
  const line = (await db(`SELECT a.id FROM owner_adjustments a JOIN expenses e ON e.id = a.expense_id WHERE e.reference = 'OCS-I1'`))[0]?.id;
  r = await call('POST', '/api/expenses/utilities', { month: OCT, rows: [{ accountId: 'ocs-acc-i', amount: 1800, receiptDocumentId: receipt, ownerPaid: true }] });
  const still = await db(`SELECT 1 AS x FROM owner_adjustments WHERE id = $1`, line ?? '');
  check('a bill whose owner line an O2 lock keeps is not replaced', r.status === 201 && (r.json?.locked ?? []).includes('OCS-I1') && !!line && still.length === 1, `${r.text} ${line}`);
}

// ── The powers: closed for every department by migrations 0302 and 0303 ──
// Review finding 1: without any lock power the route answers 403 before reading the request (the permissions matrix posts {}).
r = await call('POST', '/api/owner-close/lock', {}, 'finance_admin');
check('without any lock power the lock route refuses first', r.status === 403, r.text);
r = await lock('cleaning', [u.id], 'finance_admin');
check('without any lock power, no category can be locked', r.status === 403
  && r.json?.error?.message === "You can't lock any step. Ask management for the Lock income, Lock deductions or Lock O2 permission.", r.text);
// Given Lock income alone (a rule for the person), cleaning and O2 are still refused, each by its own power. Access
// rules are remembered for 10 seconds per person (functions/_lib/access.ts), so the check waits before asking again.
const FINANCE_ADMIN = '11111111-1111-4111-8111-000000000003';
await db(`INSERT INTO access_rules (scope, scope_id, area, level, updated_by) VALUES ('user', $1, 'lockIncome', 'edit', 'check')
  ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = 'edit'`, FINANCE_ADMIN);
await new Promise(res => setTimeout(res, 11_000));
const noClean = await lock('cleaning', [u.id], 'finance_admin');
const noO2 = await lock('o2', [u.id], 'finance_admin');
await db(`DELETE FROM access_rules WHERE scope = 'user' AND scope_id = $1 AND area = 'lockIncome'`, FINANCE_ADMIN);
check('without the powers, cleaning and O2 cannot be locked',
  noClean.status === 403 && noClean.json?.error?.message === "You can't lock cleaning. Ask management for the Lock deductions permission."
    && noO2.status === 403 && noO2.json?.error?.message === "You can't lock O2. Ask management for the Lock O2 permission.", `${noClean.text} | ${noO2.text}`);

// Remove everything the check made.
await dropAll();
done();
