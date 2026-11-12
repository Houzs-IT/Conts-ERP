// Owner statement close, part 2b (chew, 12 Nov 2026; plan
// docs/superpowers/plans/2026-11-12-owner-report-locks-part2b-company-share.md). A late change to a locked month reaches
// the company's own figures in the month the owner's share goes to (chew's choice A, 11 Nov 2026: "A：算进下个月"):
//   - the company's share: one row per lock per month in company_late_changes, posted once, split between the income
//     and deductions locks as the owner's is, skipping a month whose O2 is locked, carried back on unlock;
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55442/postgres API_BASE=http://localhost:8788 node scripts/api-checks/owner-close-late.mjs
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const OCT = '2026-10', NOV = '2026-11';
const now = new Date().toISOString();
const near = (a, b, by = 1) => Math.abs(Number(a) - Number(b)) <= by;

let r = await call('GET', `/api/owner-close?month=${OCT}`);
check('the month reads', r.status === 200 && Array.isArray(r.json?.units), r.text.slice(0, 300));
if (r.status !== 200) done();

// The check's own owner, building and units, so the checks before it in CI cannot get in its way. A local rerun starts
// from a clean slate. L-01: a share split with no contract (the default fee), the misc charge on.
const OWNER = 'ocl-owner', PROP = 'ocl-prop', UNIT = 'ocl-u';
const dropAll = async () => {
  const ofOwner = 'SELECT id FROM units WHERE owner_id = $1';
  await db(`DELETE FROM company_late_changes WHERE unit_id IN (${ofOwner})`, OWNER);
  await db(`DELETE FROM statement_lines WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM statement_units WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM owner_statements WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM owner_adjustments WHERE owner_id = $1`, OWNER);
  for (const table of ['owner_report_locks', 'expenses', 'reservations', 'owner_contracts']) await db(`DELETE FROM ${table} WHERE unit_id IN (${ofOwner})`, OWNER);
  await db(`UPDATE units SET contract_id = NULL WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM units WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM properties WHERE id = $1`, PROP);
  await db(`DELETE FROM owners WHERE id = $1`, OWNER);
};
await dropAll();
await db(`INSERT INTO owners (id, display_name, email, created_at, updated_at) VALUES ($1, 'Late Owner', 'late-owner@example.invalid', $2, $2)`, OWNER, now);
await db(`INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES ($1, 'Late Court', 'Check', 'Check', 'Check', $2, $2)`, PROP, now);
await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, misc_charges, created_at, updated_at) VALUES ($1, $2, $3, 'L-01', 0, 1, $4, $4)`, UNIT, PROP, OWNER, now);
const [u] = await db(`SELECT u.id, u.owner_id, u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = $1`, UNIT);
check('the check has its own owner and unit', !!u, 'not created');
if (!u) done();

const settings = Object.fromEntries((await db(`SELECT key, value FROM settings WHERE key IN ('locale.managementFeePct', 'finance.default_fee_pct', 'report.miscChargeMonthly')`)).map(s => [s.key, s.value]));
const defaultFee = Number(settings['locale.managementFeePct'] ?? settings['finance.default_fee_pct'] ?? 25);
const pct = 100 - defaultFee; // no contract and no split: the default fee
const miscMonthly = Number(settings['report.miscChargeMonthly'] ?? 10000);
const misc = nights => Math.round(miscMonthly * Math.min(1, nights / 31));
const owner = net => Math.round((net * pct) / 100);
const company = net => net - owner(net);
const day = n => new Date(Date.UTC(2026, 9, n)).toISOString().slice(0, 10); // day(1) = 1 Oct

const lock = (stage, unitIds) => call('POST', '/api/owner-close/lock', { month: OCT, stage, unitIds });
const unlock = (stage, unitId, reason) => call('POST', '/api/owner-close/unlock', { month: OCT, stage, unitId, reason });
const generate = (month, ownerId = OWNER) => call('POST', '/api/statements/generate', { period: month, ownerIds: [ownerId] });
const lockId = async (unitId, stage, month = OCT) => (await db(`SELECT id FROM owner_report_locks WHERE unit_id = $1 AND stage = $2 AND month = $3`, unitId, stage, month))[0]?.id ?? null;
// The company's rows for a unit, each with the stage of the lock it came from (a carried row keeps its lock's id).
const companyRows = (unitId) => db(`SELECT c.id, c.month, c.amount, c.description, c.reference FROM company_late_changes c WHERE c.unit_id = $1 ORDER BY c.month, c.id`, unitId);
const ofLock = (rows, id) => rows.filter(x => x.reference === `stage-lock:${id}`);
const ownerLate = (unitId, stage) => db(`SELECT id, amount, occurred_on FROM owner_adjustments
  WHERE unit_id = $1 AND source = 'stage_lock' AND description LIKE $2 ORDER BY occurred_on, id`, unitId, `% ${stage} for %`);
const sum = (rows) => rows.reduce((n, x) => n + Number(x.amount), 0);

// ── The company's share of a late change ──
const S1 = 'ocl-s1';
await db(`INSERT INTO reservations (id, unit_id, channel, external_ref, state, check_in, check_out, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
  VALUES ($1, $2, 'direct', $1, 'checked_out', $3, $4, 50000, 0, 50000, $5, $5)`, S1, u.id, day(2), day(7), now);
r = await generate(OCT);
check("October's draft is generated", r.status < 300, r.text);
r = await lock('income', [u.id]);
const incomeLock = await lockId(u.id, 'income');
check('October income is locked', r.status === 201 && !!incomeLock, r.text);

// C1: Airbnb (here, the booking value) pays RM 100 more after the lock. The owner's share goes to November as an owner
// adjustment; the company's share goes to November too, as a company row.
await db(`UPDATE reservations SET gross_booking_value = gross_booking_value + 10000, collected_revenue = collected_revenue + 10000 WHERE id = $1`, S1);
await generate(NOV);
let rows = await companyRows(u.id);
let inc = await ownerLate(u.id, 'income');
check("C1: the company's share of a late change goes to November",
  ofLock(rows, incomeLock).length === 1 && ofLock(rows, incomeLock)[0].month === NOV && near(ofLock(rows, incomeLock)[0].amount, company(10000))
    && ofLock(rows, incomeLock)[0].description === `Late change to Late Court L-01 income for October 2026 (income locked)`
    && inc.length === 1 && near(inc[0].amount, owner(10000)), `${JSON.stringify(rows)} want ${company(10000)}; owner ${JSON.stringify(inc)}`);
check("C1: … and the owner's and the company's shares add up to the change", near(sum(rows) + sum(inc), 10000), `${sum(rows)} + ${sum(inc)}`);

// C2: the late update runs again (generate, reconciliation, the 15-minute cron): nothing is posted twice.
await generate(NOV);
const again = await companyRows(u.id);
check('C2: running the late update again changes nothing', JSON.stringify(again) === JSON.stringify(rows), `${JSON.stringify(again)} vs ${JSON.stringify(rows)}`);

// ── R: the company views take the company's share in November ──
{
  const want = ofLock(rows, incomeLock)[0]?.amount;
  const port = (await call('GET', `/api/portfolio/owner-report?month=${NOV}`)).json;
  const pRow = port?.rows?.find(x => x.unitId === u.id);
  check('R1: the Overall owner report has the late change in November', !!want && pRow?.late === want, `${JSON.stringify(pRow)} want late ${want}`);
  const year = (await call('GET', '/api/finance/yearly-report?year=2026')).json;
  const yRow = year?.rows?.find(x => x.unitId === u.id && x.month === NOV);
  check('R2: the Yearly report has it in November', !!want && yRow?.late === want, `${JSON.stringify(yRow)} want late ${want}`);
  const fin = (await call('GET', `/api/finance/unit-pnl?from=${NOV}&to=${NOV}`)).json;
  const fRow = fin?.rows?.find(x => x.unitId === u.id && x.month === NOV);
  check('R3: Finance > Unit P&L has it in November', !!want && fRow?.late === want, `${JSON.stringify(fRow)} want late ${want}`);
  const own = (await call('GET', `/api/units/financials?unitId=${u.id}&month=${NOV}`)).json;
  const line = own?.companyPnl?.find(x => x.label === 'Late changes from locked months');
  check("R4: the unit's Financials list it under The Conts", !!want && line?.amount === want
    && line?.items?.[0]?.label === 'October 2026 income', JSON.stringify(own?.companyPnl));
  // A unit whose only figure in a month is the company's share of a late change still has its row.
  await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at) VALUES ('ocl-x', $1, $2, 'L-04', 0, $3, $3)`, PROP, OWNER, now);
  await db(`INSERT INTO company_late_changes (id, unit_id, month, amount, description, reference, created_at, updated_at) VALUES ('ocl-clc-x', 'ocl-x', $1, 1234, 'Check: a late change', 'stage-lock:ocl-none', $2, $2)`, NOV, now);
  const p2 = (await call('GET', `/api/portfolio/owner-report?month=${NOV}`)).json?.rows?.find(x => x.unitId === 'ocl-x');
  const y2 = (await call('GET', '/api/finance/yearly-report?year=2026')).json?.rows?.find(x => x.unitId === 'ocl-x' && x.month === NOV);
  const f2 = (await call('GET', `/api/finance/unit-pnl?from=${NOV}&to=${NOV}`)).json?.rows?.find(x => x.unitId === 'ocl-x' && x.month === NOV);
  check('R5: a unit with only a late change that month is still listed in all three', p2?.late === 1234 && y2?.late === 1234 && f2?.late === 1234,
    `${JSON.stringify(p2)} | ${JSON.stringify(y2)} | ${JSON.stringify(f2)}`);
  await db(`DELETE FROM company_late_changes WHERE id = 'ocl-clc-x'`);
  await db(`DELETE FROM units WHERE id = 'ocl-x'`);
}

// C3: deductions locked too (the misc charge on). The stay is made two nights longer for the same money, so occupancy
// moves the misc charge. Income comes first: the misc difference goes with the income lock, the company's as the owner's.
r = await lock('deductions', [u.id]);
const dedLock = await lockId(u.id, 'deductions');
check('October deductions are locked too', r.status === 201 && !!dedLock, r.text);
await db(`UPDATE reservations SET check_out = $1 WHERE id = $2`, day(9), S1);
await generate(NOV);
rows = await companyRows(u.id);
inc = await ownerLate(u.id, 'income');
const ded = await ownerLate(u.id, 'deductions');
const dMisc = misc(7) - misc(5);
check('C3: with income and deductions locked, the misc difference goes with income for the company too',
  ofLock(rows, incomeLock).length === 1 && near(ofLock(rows, incomeLock)[0].amount, company(10000 - dMisc), 2) && near(sum(ofLock(rows, dedLock)), 0),
  `${JSON.stringify(rows)} want income ${company(10000 - dMisc)}, deductions 0`);
check("C3: … and the shares still add up to the month's change", near(sum(rows) + sum(inc) + sum(ded), 10000 - dMisc, 2),
  `${sum(rows)} + ${sum(inc)} + ${sum(ded)} want ${10000 - dMisc}`);

// C4: November's O2 is locked (written here: November has not ended, so the route refuses it), then October changes
// again. The new difference goes to December; November's row stays as it was.
const novId = (await db(`SELECT id FROM owner_statements WHERE owner_id = $1 AND period_start = '2026-11-01'`, OWNER))[0]?.id ?? null;
const novKeeps = await db(`SELECT id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, statement_id FROM owner_adjustments
  WHERE unit_id = $1 AND state = 'open' AND occurred_on < '2026-12-01' AND (statement_id IS NULL OR statement_id = $2)`, u.id, novId);
await db(`INSERT INTO owner_report_locks (id, month, unit_id, stage, frozen, locked_by, locked_by_name, locked_at) VALUES ('ocl-o2-nov', $1, $2, 'o2', $3, 'check', 'Check', $4)`,
  NOV, u.id, JSON.stringify({ adjustments: novKeeps }), now);
const onNov = ofLock(rows, incomeLock)[0];
await db(`UPDATE reservations SET gross_booking_value = gross_booking_value + 5000, collected_revenue = collected_revenue + 5000 WHERE id = $1`, S1);
await generate(NOV);
rows = await companyRows(u.id);
const mine = ofLock(rows, incomeLock);
check("C4: a late change skips a month whose O2 is locked; the row already there stays",
  mine.length === 2 && mine[0].id === onNov?.id && mine[0].amount === onNov?.amount && mine[1].month === '2026-12' && near(mine[1].amount, company(5000)),
  `${JSON.stringify(mine)} want ${onNov?.amount} on November and ${company(5000)} on December`);

// C5: October income unlocked. December's row can still move, so it goes; November's is settled (its O2 is locked), so
// it stays and October takes a row of the opposite amount: across the months the company counts the change once.
r = await unlock('income', u.id, 'Check the company share');
rows = await companyRows(u.id);
const carried = rows.filter(x => x.reference === `stage-lock-carried:${incomeLock}`);
check('C5: unlocking withdraws what can move and carries back what is settled',
  r.status === 200 && ofLock(rows, incomeLock).length === 1 && ofLock(rows, incomeLock)[0].id === onNov?.id
    && carried.length === 1 && carried[0].month === OCT && carried[0].amount === -onNov?.amount && carried[0].description === 'Already counted in November 2026',
  `${r.text} ${JSON.stringify(rows)}`);
check("C5: … so the income lock's rows add up to nothing", sum(ofLock(rows, incomeLock)) + sum(carried) === 0, JSON.stringify(rows));

// C6: and the next late update posts nothing for the lock that is gone.
await generate(NOV);
const after = await companyRows(u.id);
check('C6: the late update after an unlock writes nothing more for it',
  JSON.stringify(after.filter(x => x.reference.endsWith(incomeLock))) === JSON.stringify(rows.filter(x => x.reference.endsWith(incomeLock))), JSON.stringify(after));

// ── N: someone editing a reservation in a month whose income is locked is told where the difference goes ──
// On the check's own unit L-03, with only its October income locked (nothing in the checks above reaches it).
{
  const N = 'ocl-n', want = 'October 2026 income is locked for Late Court L-03. The difference goes to November 2026.';
  await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at) VALUES ($1, $2, $3, 'L-03', 0, $4, $4)`, N, PROP, OWNER, now);
  const stay = (id, from, to, gross) => db(`INSERT INTO reservations (id, unit_id, channel, external_ref, state, check_in, check_out, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
    VALUES ($1, $2, 'direct', $1, 'confirmed', $3, $4, $5, 0, $5, $6, $6)`, id, N, from, to, gross, now);
  await stay('ocl-n1', '2026-10-05', '2026-10-09', 20000);
  await stay('ocl-n2', '2026-10-30', '2026-11-02', 15000);
  await stay('ocl-n3', '2026-12-10', '2026-12-12', 10000);
  r = await lock('income', [N]);
  check('L-03: October income is locked', r.status === 201, r.text);

  r = await call('PATCH', '/api/reservations/ocl-n1/dates', { checkIn: '2026-10-05', checkOut: '2026-10-10', confirm: true });
  check('N1: moving a checkout in a locked month says where the difference goes', r.status === 200 && r.json?.notice === want, r.text);
  r = await call('PATCH', '/api/reservations/ocl-n2/dates', { checkIn: '2026-10-30', checkOut: '2026-11-03', confirm: true });
  check('N2: a stay across two months names only the locked one', r.status === 200 && r.json?.notice === want, r.text);
  r = await call('PATCH', '/api/reservations/ocl-n3/dates', { checkIn: '2026-12-11', checkOut: '2026-12-13', confirm: true });
  check('N3: a change in open months says nothing', r.status === 200 && r.json?.notice === null, r.text);

  r = await call('POST', '/api/reservations', { unitId: N, channel: 'direct', guest: { fullName: 'Late Check Guest' }, checkIn: '2026-10-20', checkOut: '2026-10-22', guestsCount: 1, grossBookingValue: 30000 });
  const made = r.json?.id;
  check('N4: a new reservation in a locked month is told', r.status === 201 && r.json?.notice === want, r.text);
  r = await call('POST', `/api/reservations/${made}/cancel`, { reason: 'Check: cancelled after the lock' });
  check('N4: … and so is cancelling it', r.status === 200 && r.json?.notice === want, r.text);
  // A direct booking with no guest total is paid by what is recorded against it, so a payment changes its income.
  r = await call('POST', '/api/reservations', { unitId: N, channel: 'direct', guest: { fullName: 'Late Check Payer' }, checkIn: '2026-10-23', checkOut: '2026-10-25', guestsCount: 1, grossBookingValue: 0 });
  const paid = r.json?.id;
  r = await call('POST', `/api/reservations/${paid}/payments`, { amount: 20000, receivedOn: '2026-10-23', method: 'cash', kind: 'guest_payment' });
  check('N4: … and recording a payment on a booking with no guest total', r.status === 201 && r.json?.notice === want, r.text);
  const pid = r.json?.id;
  r = await call('DELETE', `/api/reservations/${paid}/payments/${pid}`);
  check('N4: … and removing it', r.status === 200 && r.json?.notice === want, r.text);
  await db(`DELETE FROM booking_payments WHERE reservation_id IN (SELECT id FROM reservations WHERE unit_id = $1)`, N);
}

// Remove everything the check made.
await dropAll();
done();
