// Owner report close, part 1: income locks (chew, 11 Nov 2026; plan docs/superpowers/plans/2026-11-11-owner-report-locks-part1-income.md).
// Locking a month's income for ticked units freezes it; a later change to a booking reaches the owner once, as an owner
// adjustment on the next open month, worked out again through the contract; unlocking (with a reason) brings the month
// back, withdrawing what can be withdrawn and balancing what already sits on a final statement:
//   - lock, lock again (a no-op), a month before October 2026 refused, a stage other than income refused, the month
//     running now refused;
//   - a changed booking leaves the locked income alone and its difference lands on November once, however often the
//     statements are generated; a stay across October and November sends only its October part there;
//   - a November draft that printed the difference is not finalised once the difference changed or was withdrawn,
//     until it is generated again;
//   - unlock needs a reason, withdraws an open difference, names the draft to generate again, and with November final
//     balances October instead; a final October cannot be unlocked, and a unit whose October is final cannot be locked;
//   - unlock waits for a late-income update that is running (Postgres only);
//   - a master-lease unit is not on the income step; a long-term let keeps its locked rent when the tenancy dates
//     change, and the rent difference is posted;
//   - a finance admin without the Lock income and Unlock a step powers (migration 0302 closed them) is refused.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55441/postgres API_BASE=http://localhost:8788 node scripts/api-checks/owner-close.mjs
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
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1;

let r = await call('GET', `/api/owner-close?month=${OCT}`);
check('the month reads (migration 0302)', r.status === 200 && Array.isArray(r.json?.units), r.text.slice(0, 300));
if (r.status !== 200) done();

// Two units of different owners whose October and November statements are not final (a draft is fine: generating
// rebuilds it; the airbnb-recon check before this one in CI finalises one owner's October): no contract, or a
// management one with no minimum, so the owner's share is a plain percentage.
const open = await db(`SELECT u.id, u.owner_id, u.contract_id, u.split_kind, u.split_value, c.management_fee_pct AS fee FROM units u
  LEFT JOIN owner_contracts c ON c.id = u.contract_id
  WHERE u.parent_unit_id IS NULL AND (c.id IS NULL OR (coalesce(c.revenue_model, c.model) = 'management' AND coalesce(c.minimum_guarantee, 0) = 0))
    AND NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = u.owner_id AND substr(s.period_start, 1, 7) IN ('2026-10', '2026-11')
                      AND s.state IN ('finalised', 'sent', 'paid'))
  ORDER BY u.id`);
// The unit needs free nights for this check's two stays: A, two nights in October; B, from the end of October into
// November (nights in both months).
const day = n => new Date(Date.UTC(2026, 9, n)).toISOString().slice(0, 10); // day(1) = 1 Oct, day(32) = 1 Nov
const windowsOf = async unitId => {
  const busy = await db(`SELECT check_in, check_out FROM reservations WHERE unit_id = $1 AND state <> 'cancelled' AND id NOT IN ('oc-check-a', 'oc-check-b')
    AND check_out > '2026-10-01' AND check_in < '2026-12-01'`, unitId);
  const free = (a, b) => !busy.some(s => String(s.check_in) < b && String(s.check_out) > a);
  let a = 0, b = null;
  for (let d = 2; d <= 26 && !a; d++) if (free(day(d), day(d + 2))) a = d;
  for (let s = 31; s >= 22 && !b; s--) for (let e = s + 8; e >= 33 && !b; e--) if (free(day(s), day(e))) b = { s, e };
  return a && b ? { a, b } : null;
};
let u = null, win = null;
for (const c of open) { const w = await windowsOf(c.id); if (w) { u = c; win = w; break; } }
const lt = open.find(x => x.owner_id !== u?.owner_id);
check('two units of different owners, October and November open, one with free nights', !!u && !!lt, `${open.length} units`);
if (!u || !lt) done();

// The owner's share as termsFor reads it for these units.
const settings = Object.fromEntries((await db(`SELECT key, value FROM settings WHERE key IN ('locale.managementFeePct', 'finance.default_fee_pct')`)).map(s => [s.key, s.value]));
const defaultFee = Number(settings['locale.managementFeePct'] ?? settings['finance.default_fee_pct'] ?? 25);
const pct = u.contract_id ? 100 - Number(u.fee ?? defaultFee)
  : /profit share/i.test(u.split_kind ?? '') && u.split_value != null ? Number(u.split_value) : 100 - defaultFee;

// A clean start for this check's own rows (a local rerun).
const A = 'oc-check-a', B = 'oc-check-b', LTC = 'oc-check-lt';
await db(`DELETE FROM owner_adjustments WHERE source = 'stage_lock' AND unit_id IN ($1, $2)`, u.id, lt.id);
await db(`DELETE FROM owner_report_locks WHERE unit_id IN ($1, $2)`, u.id, lt.id);
await db(`DELETE FROM reservations WHERE id IN ($1, $2)`, A, B);

await db(`INSERT INTO reservations (id, unit_id, channel, external_ref, state, check_in, check_out, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
  VALUES ($1, $3, 'direct', $1, 'checked_out', $4, $5, 30000, 0, 30000, $8, $8), ($2, $3, 'direct', $2, 'confirmed', $6, $7, 80000, 0, 80000, $8, $8)`,
  A, B, u.id, day(win.a), day(win.a + 2), day(win.b.s), day(win.b.e), now);
const bNights = win.b.e - win.b.s, bOctNights = 32 - win.b.s;

const income = async (month, unitId) => (await call('GET', `/api/owner-close?month=${month}`)).json?.units?.find(x => x.unitId === unitId)?.income;
const lateOf = unitId => db(`SELECT id, amount, occurred_on, state, reference, description FROM owner_adjustments WHERE unit_id = $1 AND source = 'stage_lock' ORDER BY created_at, id`, unitId);
const generate = (month, ownerId) => call('POST', '/api/statements/generate', { period: month, ownerIds: [ownerId] });
const lock = (unitId, month = OCT, stage = 'income', role) => call('POST', '/api/owner-close/lock', { month, stage, unitIds: [unitId] }, role);
const unlock = (unitId, reason, role) => call('POST', '/api/owner-close/unlock', { month: OCT, stage: 'income', unitId, reason }, role);

// Locking.
r = await call('GET', `/api/owner-close?month=${OCT}`);
const row = r.json.units.find(x => x.unitId === u.id);
check('the unit is listed, not locked yet', !!row && row.incomeLock === null && r.json.may?.lockIncome === true, JSON.stringify(row));
const oct0 = row?.income;
r = await lock(u.id);
check('locking October income locks the ticked unit', r.status === 201 && r.json?.locked?.length === 1 && r.json.locked[0] === u.id, r.text);
r = await lock(u.id);
check('locking it again changes nothing', r.status === 200 && !r.json?.locked?.length && r.json?.already?.includes(u.id), r.text);
r = await call('GET', `/api/owner-close?month=${OCT}`);
check('the page shows who locked it', !!r.json.units.find(x => x.unitId === u.id)?.incomeLock?.by && r.json.counts.income.locked >= 1, JSON.stringify(r.json.counts));
r = await lock(u.id, '2026-09');
check('September cannot be locked', r.status === 422 && r.json?.error?.message === 'Locks start from October 2026.', r.text);
r = await lock(u.id, OCT, 'deductions');
check('only income can be locked so far', r.status === 422 && r.json?.error?.message === 'Only income can be locked so far.', r.text);
// The month running now (Malaysia time) would freeze half its reservations (review finding 3).
const thisMonth = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
const running = `${new Date(`${thisMonth}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} has not ended yet.`;
r = await lock(u.id, thisMonth);
check('a month that has not ended cannot be locked', r.status === 422 && r.json?.error?.message === running, r.text);
r = await call('GET', `/api/owner-close?month=${thisMonth}`);
check('… and its page says so', r.json?.lockProblem === running, JSON.stringify(r.json?.lockProblem));

// A changed booking: the locked income stays, the difference lands on November once.
await db(`UPDATE reservations SET gross_booking_value = gross_booking_value + 10000, collected_revenue = collected_revenue + 10000 WHERE id = $1`, A);
check('a locked month keeps its income', (await income(OCT, u.id)) === oct0, `${await income(OCT, u.id)} vs ${oct0}`);
r = await generate(NOV, u.owner_id);
let late = await lateOf(u.id);
check('the change reaches November as one owner adjustment',
  r.status < 300 && late.length === 1 && String(late[0].occurred_on).startsWith('2026-11-01') && late[0].state === 'open' && near(late[0].amount, Math.round(10000 * pct / 100)),
  `${r.status} ${JSON.stringify(late)}`);
await generate(NOV, u.owner_id);
const again = await lateOf(u.id);
check('generating again posts nothing more', again.length === 1 && Number(again[0].amount) === Number(late[0]?.amount), JSON.stringify(again));

// A stay across October and November: only its October part goes to the adjustment; November follows the change.
const nov0 = await income(NOV, u.id);
await db(`UPDATE reservations SET gross_booking_value = gross_booking_value + 8000, collected_revenue = collected_revenue + 8000 WHERE id = $1`, B);
// The November draft already prints the earlier difference. Generating October brings the late difference up to date
// without building November again, so the draft no longer matches what the owner is due: marking it final is
// refused until it is generated again (review finding 1).
await generate(OCT, u.owner_id);
const novId = async () => (await db(`SELECT id FROM owner_statements WHERE owner_id = $1 AND period_start = '2026-11-01'`, u.owner_id))[0]?.id;
const finalise = async () => call('POST', '/api/statements/finalise', { statementIds: [await novId()] });
const backToDraft = async () => db(`UPDATE owner_statements SET state = 'provisional', finalised_at = NULL WHERE id = $1`, await novId());
const STALE = 'An owner adjustment changed after this draft was made. Generate the statement again, then mark it final.';
r = await finalise();
check('a draft whose late difference changed since it was made cannot be marked final', r.status === 200 && r.json?.finalised === 0 && r.json?.failed?.[0]?.reason === STALE, r.text);
await backToDraft();
await generate(NOV, u.owner_id);
late = await lateOf(u.id);
const octPart = (8000 * bOctNights) / bNights;
check('a stay across months sends only its October part', late.length === 1 && near(late[0].amount, Math.round(((10000 + octPart) * pct) / 100)), JSON.stringify(late));
check('November follows the change itself', near((await income(NOV, u.id)) - nov0, 8000 - octPart), `${await income(NOV, u.id)} - ${nov0}`);
r = await finalise();
check('generated again, it can be marked final', r.status === 200 && r.json?.finalised === 1, r.text);
await backToDraft();

// Unlocking.
r = await unlock(u.id, '');
check('unlocking needs a reason', r.status === 422 && r.json?.error?.message === 'Say why you are unlocking.', r.text);
r = await unlock(u.id, 'Correct the booking');
check('unlocking with a reason works', r.status === 200, r.text);
check('… and names the November draft to generate again', JSON.stringify(r.json?.regenerate) === JSON.stringify([NOV]), r.text);
check('unlocking withdraws the open difference', (await lateOf(u.id)).length === 0, JSON.stringify(await lateOf(u.id)));
r = await finalise();
check('the November draft that printed it cannot be marked final until generated again', r.status === 200 && r.json?.finalised === 0 && r.json?.failed?.[0]?.reason === STALE, r.text);
await backToDraft();
await generate(NOV, u.owner_id);
r = await finalise();
check('generated again, it can be marked final', r.status === 200 && r.json?.finalised === 1, r.text);
await backToDraft();
check("the month is back to today's data", near(await income(OCT, u.id), oct0 + 10000 + octPart), `${await income(OCT, u.id)} vs ${oct0 + 10000 + octPart}`);
const why = await db(`SELECT after_state FROM audit_log WHERE action = 'owner_report.unlock' AND entity_id = $1 ORDER BY occurred_at DESC LIMIT 1`, u.id);
check('the reason is kept in the history', JSON.stringify(why[0]?.after_state ?? '').includes('Correct the booking'), JSON.stringify(why));

// November final: unlocking October keeps November's difference and balances October; a final October is refused.
await lock(u.id);
await db(`UPDATE reservations SET gross_booking_value = gross_booking_value + 2000, collected_revenue = collected_revenue + 2000 WHERE id = $1`, A);
await generate(NOV, u.owner_id);
late = await lateOf(u.id);
check('a new lock posts its own difference', late.length === 1 && near(late[0].amount, Math.round((2000 * pct) / 100)), JSON.stringify(late));
await db(`UPDATE owner_statements SET state = 'finalised', finalised_at = $2 WHERE owner_id = $1 AND period_start = '2026-11-01'`, u.owner_id, now);
r = await unlock(u.id, 'Check the balance');
const after = await lateOf(u.id);
const carried = after.find(x => String(x.reference).startsWith('stage-lock-carried:'));
check('with November final, unlocking keeps November and balances October',
  r.status === 200 && after.some(x => x.id === late[0]?.id) && !!carried && Number(carried.amount) === -Number(late[0]?.amount)
    && String(carried.occurred_on).startsWith('2026-10-01') && carried.description === 'Already settled on the November 2026 statement',
  `${r.text} ${JSON.stringify(after)}`);
await lock(u.id);
await generate(OCT, u.owner_id);
await db(`UPDATE owner_statements SET state = 'finalised', finalised_at = $2 WHERE owner_id = $1 AND period_start = '2026-10-01'`, u.owner_id, now);
r = await unlock(u.id, 'This should be refused');
check('a final month cannot be unlocked', r.status === 409 && r.json?.error?.message === 'The October 2026 statement is final. Unlock the final statement first.', r.text);
// A unit whose month is already final is not locked: a lock would keep today's stays, not what that statement paid
// (review finding 3). The lock is taken off by hand here, as a final month cannot be unlocked.
await db(`DELETE FROM owner_report_locks WHERE unit_id = $1`, u.id);
r = await lock(u.id);
check('a unit whose October statement is final is not locked', r.status === 200 && !r.json?.locked?.length && !!r.json?.final?.includes(u.id), r.text);
r = await call('GET', `/api/owner-close?month=${OCT}`);
check('… and the page shows its statement is final', r.json?.units?.find(x => x.unitId === u.id)?.statementFinal === true, JSON.stringify(r.json?.units?.find(x => x.unitId === u.id)));
await db(`UPDATE owner_statements SET state = 'provisional', finalised_at = NULL WHERE owner_id = $1 AND period_start IN ('2026-10-01', '2026-11-01')`, u.owner_id);

// Unlock waits for a late-income update that is running, then withdraws what it wrote (review finding 2). Postgres
// only: PGlite runs one transaction at a time, so an unlock and an update can never overlap there.
if (/emscripten|emcc/i.test(String((await db('SELECT version() AS v'))[0]?.v ?? ''))) {
  console.log('  (skipped on PGlite: unlock waiting for a running late-income update needs Postgres)');
} else {
  await lock(u.id);
  const lockId = (await db(`SELECT id FROM owner_report_locks WHERE unit_id = $1 AND month = $2 AND stage = 'income'`, u.id, OCT))[0]?.id;
  const side = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  let finished = false, pending = null;
  try {
    await side.begin(async sql => {
      await sql.unsafe(`SELECT pg_advisory_xact_lock(hashtext('owner-report-late-income'))`);
      pending = unlock(u.id, 'Unlocked during an update').then(x => { finished = true; return x; });
      await new Promise(res => setTimeout(res, 1500));
      check('unlock waits for a late-income update that is running', !finished);
      await sql.unsafe(`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
        VALUES ('oc-check-race', $1, $2, 'credit', 100, 'Written by the running update', '2026-11-01', $3, 'open', 'stage_lock', NULL, $4, $4)`, [u.owner_id, u.id, `stage-lock:${lockId}`, now]);
    });
  } finally { await side.end({ timeout: 5 }); }
  r = await pending;
  check('… then unlocks and withdraws what the update wrote', r?.status === 200 && !(await db(`SELECT 1 AS x FROM owner_adjustments WHERE id = 'oc-check-race'`)).length, r?.text);
}

// A long-term let: its locked rent stays when the tenancy dates change; the rent difference reaches the owner.
const ltBefore = lt.contract_id;
await db(`DELETE FROM owner_contracts WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM units WHERE contract_id = $1)`, LTC);
// First as a master lease: the owner is paid the same whatever the unit earns, so it has no income to lock (review
// finding 4; new fixed-rent contracts are refused since migration 0206). An October owner credit puts it in the month.
await db(`INSERT INTO owner_contracts (id, owner_id, unit_id, management_fee_pct, starts_on, ends_on, created_at, model, revenue_model, grr_amount, minimum_guarantee, misc_charges)
  VALUES ($1, $2, $3, 10, '2026-01-01', '2026-12-31', $4, 'management', 'master_lease', 300000, 0, 0)
  ON CONFLICT (id) DO UPDATE SET ends_on = '2026-12-31', revenue_model = 'master_lease', grr_amount = 300000, management_fee_pct = 10`, LTC, lt.owner_id, lt.id, now);
await db(`UPDATE units SET contract_id = $1 WHERE id = $2`, LTC, lt.id);
await db(`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
  VALUES ('oc-check-ml', $1, $2, 'credit', 1000, 'Check credit', '2026-10-15', NULL, 'open', 'manual', NULL, $3, $3) ON CONFLICT (id) DO NOTHING`, lt.owner_id, lt.id, now);
r = await call('GET', `/api/owner-close?month=${OCT}`);
check('a master-lease unit is not on the income step', r.status === 200 && !r.json.units.some(x => x.unitId === lt.id), JSON.stringify(r.json?.units?.find(x => x.unitId === lt.id)));
r = await lock(lt.id);
check('… and is not locked', r.status === 200 && !r.json?.locked?.length && !!r.json?.notLockable?.includes(lt.id), r.text);
await db(`DELETE FROM owner_adjustments WHERE id = 'oc-check-ml'`);
await db(`INSERT INTO owner_contracts (id, owner_id, unit_id, management_fee_pct, starts_on, ends_on, created_at, model, revenue_model, grr_amount, minimum_guarantee, misc_charges)
  VALUES ($1, $2, $3, 10, '2026-01-01', '2026-12-31', $4, 'management', 'long_term', 300000, 0, 0)
  ON CONFLICT (id) DO UPDATE SET ends_on = '2026-12-31', revenue_model = 'long_term', grr_amount = 300000, management_fee_pct = 10`, LTC, lt.owner_id, lt.id, now);
await db(`UPDATE units SET contract_id = $1 WHERE id = $2`, LTC, lt.id);
check('a long-term let earns its rent', (await income(OCT, lt.id)) === 300000, String(await income(OCT, lt.id)));
r = await lock(lt.id);
await db(`UPDATE owner_contracts SET ends_on = '2026-10-15' WHERE id = $1`, LTC);
check('its locked rent stays when the tenancy dates change', (await income(OCT, lt.id)) === 300000, String(await income(OCT, lt.id)));
await generate(NOV, lt.owner_id);
const ltLate = await lateOf(lt.id);
// Live October: 15 of 31 days, RM 1,451.61; the owner keeps 90% of the rent, so the owner's difference is -RM 1,393.55.
check('the rent difference reaches November', ltLate.length === 1 && Math.abs(Number(ltLate[0].amount) + 139355) <= 2, JSON.stringify(ltLate));
await db(`UPDATE units SET contract_id = $1 WHERE id = $2`, ltBefore ?? null, lt.id);

// The powers: closed for every department by migration 0302.
r = await lock(u.id, OCT, 'income', 'finance_admin');
check('a finance admin without Lock income is refused', r.status === 403, r.text);
r = await unlock(u.id, 'No power', 'finance_admin');
check('a finance admin without Unlock a step is refused', r.status === 403, r.text);
r = await call('GET', `/api/owner-close?month=${OCT}`, undefined, 'finance_admin');
check('the page is closed to a finance admin until management opens it', r.status === 403, r.text);
done();
