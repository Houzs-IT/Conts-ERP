// Unit report click-to-lock (chew, 13 Nov 2026; spec docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md,
// plan docs/superpowers/plans/2026-11-13-unit-report-click-locks.md, Task 7). The Unit report carries what each amount's
// lock needs:
//   - each unit's categories (six on a share), who locked each and when, its Airbnb reservations still to confirm, and a
//     hint for each amount (what is in it);
//   - the month's counts per category, the Airbnb file count and what this person may do;
//   - O2 as the owner's statement takes it (builder check answers): an open adjustment dated in September is in
//     October's O2, one on a final September statement is not; the O2 lock keeps the same set;
//   - Revenue held back while a reservation is still to confirm (notReady, review focus 3);
//   - Lock all and Unlock all over a whole category, with no reason (review focus 2: a final owner's unit stays locked).
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55442/postgres API_BASE=http://localhost:8788 node scripts/api-checks/owner-report-locks.mjs
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const OCT = '2026-10';
const now = new Date().toISOString();
const SIX = ['income', 'cleaning', 'utilities', 'additional', 'misc', 'o2'];

// The check's own owner, building and unit with a management contract (the Unit report lists units with a contract), so
// the checks before it in CI cannot get in its way. A local rerun starts from a clean slate.
const OWNER = 'orl-owner', PROP = 'orl-prop', UNIT = 'orl-u', CODE = 'HMORLCHK01', FILE = 'owner-report-locks-check.csv';
const dropAll = async () => {
  const ofOwner = 'SELECT id FROM units WHERE owner_id = $1';
  await db(`DELETE FROM airbnb_recon_decisions WHERE code = $1`, CODE).catch(() => {});
  await db(`DELETE FROM airbnb_recon_files WHERE file_name = $1`, FILE).catch(() => {});
  await db(`DELETE FROM company_late_changes WHERE unit_id IN (${ofOwner})`, OWNER);
  await db(`UPDATE owner_adjustments SET statement_id = NULL WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM statement_lines WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM statement_units WHERE statement_id IN (SELECT id FROM owner_statements WHERE owner_id = $1)`, OWNER);
  await db(`DELETE FROM owner_statements WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM owner_adjustments WHERE owner_id = $1`, OWNER);
  for (const table of ['owner_report_locks', 'expenses', 'reservations']) await db(`DELETE FROM ${table} WHERE unit_id IN (${ofOwner})`, OWNER);
  await db(`UPDATE units SET contract_id = NULL WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM owner_contracts WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM units WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM properties WHERE id = $1`, PROP);
  await db(`DELETE FROM owners WHERE id = $1`, OWNER);
};
await dropAll();
const settings = Object.fromEntries((await db(`SELECT key, value FROM settings WHERE key IN ('locale.managementFeePct', 'finance.default_fee_pct')`)).map(s => [s.key, s.value]));
const fee = Number(settings['locale.managementFeePct'] ?? settings['finance.default_fee_pct'] ?? 25);
await db(`INSERT INTO owners (id, display_name, email, created_at, updated_at) VALUES ($1, 'Lock Owner', 'lock-owner@example.invalid', $2, $2)`, OWNER, now);
await db(`INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES ($1, 'Lock Court', 'Check', 'Check', 'Check', $2, $2)`, PROP, now);
await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, misc_charges, created_at, updated_at) VALUES ($1, $2, $3, 'K-01', 0, 1, $4, $4)`, UNIT, PROP, OWNER, now);
await db(`INSERT INTO owner_contracts (id, owner_id, unit_id, management_fee_pct, starts_on, ends_on, created_at, model, revenue_model, grr_amount, minimum_guarantee, misc_charges)
  VALUES ('orl-c', $1, $2, $3, '2020-01-01', NULL, $4, 'management', 'management', 0, 0, 1)`, OWNER, UNIT, fee, now);
await db(`UPDATE units SET contract_id = 'orl-c' WHERE id = $1`, UNIT);

// October: an Airbnb stay that Airbnb paid differently (to confirm), a direct stay, a clean, an electricity bill and an
// aircon service charged to the owner.
await db(`INSERT INTO reservations (id, unit_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
  VALUES ('orl-s1', $1, 'airbnb', $2, 'checked_out', '2026-10-03', '2026-10-06', 2, 28196, 4425, 0, $3, $3),
         ('orl-s2', $1, 'direct', 'orl-s2', 'checked_out', '2026-10-10', '2026-10-12', 2, 20000, 0, 20000, $3, $3)`, UNIT, CODE, now);
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ('orl-e1', $1, 'cleaning', 'Check: clean', 8000, 'MYR', '2026-10-07', 'owner', $2),
         ('orl-e2', $1, 'electricity', 'Check: power', 12000, 'MYR', '2026-10-15', 'owner', $2),
         ('orl-e3', $1, 'other', 'Check: aircon service', 5000, 'MYR', '2026-10-20', 'owner', $2)`, UNIT, now);
// O2: an open charge dated in September (October's statement takes it), a September credit on a final September
// statement (it is not October's), and an October credit.
await db(`INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, net_payout, generated_at, created_at)
  VALUES ('orl-sep', $1, '2026-09-01', '2026-09-30', 'finalised', 1000, $2, $2)`, OWNER, now);
await db(`INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, statement_id, created_by, created_at, updated_at)
  VALUES ('orl-a1', $1, $2, 'charge', -3000, 'Check: September charge entered late', '2026-09-20', NULL, 'open', 'manual', NULL, NULL, $3, $3),
         ('orl-a2', $1, $2, 'credit', 1000, 'Check: September credit, paid in September', '2026-09-10', NULL, 'open', 'manual', 'orl-sep', NULL, $3, $3),
         ('orl-a3', $1, $2, 'credit', 500, 'Check: October credit', '2026-10-05', NULL, 'open', 'manual', NULL, NULL, $3, $3)`, OWNER, UNIT, now);

// The Airbnb file: the stay was extended and paid in two parts (the reconciliation proposes setting it to Airbnb's RM 297.66).
const line = (date, type, code, amount, o = {}) => ({
  Date: date, Type: type, 'Confirmation code': code, 'Start date': o.start ?? '', 'End date': o.end ?? '', Nights: o.nights ?? '', Guest: 'Check Guest',
  Listing: 'Check listing', Details: o.details ?? '', 'Reference code': '', Currency: 'MYR', Amount: amount, 'Paid out': '',
});
let r = await call('POST', '/api/airbnb-recon/upload', { month: OCT, files: [{ name: FILE, rows: [
  line('10/04/2026', 'Reservation', CODE, '237.71', { start: '10/03/2026', end: '10/06/2026', nights: '3' }),
  line('10/05/2026', 'Reservation', CODE, '59.95', { start: '10/03/2026', end: '10/06/2026', nights: '3' }),
] }] });
check('the Airbnb file uploads', r.status < 300, r.text.slice(0, 300));
r = await call('POST', '/api/statements/generate', { period: OCT, ownerIds: [OWNER] });
check("October's draft is generated", r.status < 300, r.text.slice(0, 300));

const report = async () => (await call('GET', `/api/portfolio/owner-report?month=${OCT}`)).json;
const rowOf = j => j?.rows?.find(x => x.unitId === UNIT);
const lock = (stage, unitIds) => call('POST', '/api/owner-close/lock', { month: OCT, stage, unitIds });
const unlock = (stage, unitIds, reason) => call('POST', '/api/owner-close/unlock', { month: OCT, stage, unitIds, ...(reason ? { reason } : {}) });

// ── The payload ──
let j = await report();
let row = rowOf(j);
check('the unit is on all six categories, none locked yet', !!row && JSON.stringify(row.steps) === JSON.stringify(SIX) && Object.keys(row.locks ?? {}).length === 0, JSON.stringify({ steps: row?.steps, locks: row?.locks }));
check('its Revenue waits for one Airbnb reservation to be confirmed', row?.toConfirm === 1, String(row?.toConfirm));
check('each amount says what is in it', /2 reservations/.test(row?.hints?.income ?? '') && /Electricity/.test(row?.hints?.utilities ?? '')
  && /aircon service/i.test(row?.hints?.additional ?? '') && /occupancy/.test(row?.hints?.misc ?? '') && /September charge entered late/.test(row?.hints?.o2 ?? ''),
  JSON.stringify(row?.hints));
check('O2 is what the statement takes: the late September charge and the October credit, not the paid September credit',
  row?.o2 === -2500, String(row?.o2));
check('the month has its counts, its Airbnb file and what management may do',
  SIX.every(s => typeof j?.counts?.[s]?.total === 'number') && (j?.airbnbFiles ?? 0) >= 1 && SIX.every(s => j?.may?.lock?.[s] === true) && j?.may?.unlock === true
    && j?.may?.makeFinal === true && j?.may?.generate === true, JSON.stringify({ counts: j?.counts, files: j?.airbnbFiles, may: j?.may }));

// ── Locking from the report ──
r = await lock('cleaning', [UNIT]);
j = await report();
row = rowOf(j);
check('a cleaning lock shows on the row, by whom and when', r.status === 201 && !!row?.locks?.cleaning?.by && !!row?.locks?.cleaning?.at && (j?.counts?.cleaning?.locked ?? 0) >= 1,
  `${r.text} ${JSON.stringify(row?.locks)}`);
r = await lock('income', [UNIT]);
check('Revenue is held back while a reservation is still to confirm', r.status === 200 && !(r.json?.locked ?? []).length
  && r.json?.notReady?.[0]?.unitId === UNIT && r.json.notReady[0].reason === '1 Airbnb reservation still to confirm on Airbnb reconciliation.', r.text);
r = await call('GET', `/api/owner-close/summary?month=${OCT}`);
check('… and the work pages are told which unit waits', (r.json?.notReady ?? []).some(x => x.unitId === UNIT && x.label === 'Lock Court K-01'), r.text.slice(0, 400));
r = await lock('o2', [UNIT]);
const kept = (await db(`SELECT frozen FROM owner_report_locks WHERE unit_id = $1 AND month = $2 AND stage = 'o2'`, UNIT, OCT))[0]?.frozen;
const keptIds = (kept?.adjustments ?? []).map(a => a.id).sort();
check('the O2 lock keeps the amount the report shows', r.status === 201 && JSON.stringify(keptIds) === JSON.stringify(['orl-a1', 'orl-a3']), JSON.stringify(keptIds));
const waiting = (await report())?.owners?.[OWNER]?.waiting;
check('Make final waits for the rest, named as the report names them', waiting === 'Waiting: Revenue, Utilities, Add. ded. and Misc', String(waiting));

// ── Lock all and Unlock all over a whole category (every unit of October, so it is undone at once) ──
r = await lock('misc', 'all');
const lockedMisc = r.json?.locked ?? [];
check('Lock all locks every unit the category lists', r.status === 201 && lockedMisc.includes(UNIT), r.text.slice(0, 300));
await db(`UPDATE owner_statements SET state = 'finalised', finalised_at = $2 WHERE owner_id = $1 AND period_start = '2026-10-01'`, OWNER, now);
r = await unlock('misc', 'all');
const stillMisc = (await db(`SELECT unit_id FROM owner_report_locks WHERE month = $1 AND stage = 'misc'`, OCT)).map(x => x.unit_id);
check('Unlock all, with no reason, unlocks every unit whose owner is not final and names the final one',
  r.status === 200 && (r.json?.refused ?? []).some(x => x.unitId === UNIT && /final/.test(x.problem)) && stillMisc.length === 1 && stillMisc[0] === UNIT
    && lockedMisc.filter(id => id !== UNIT).every(id => (r.json?.unlocked ?? []).includes(id)), `${r.text.slice(0, 400)} still ${JSON.stringify(stillMisc)}`);
await db(`UPDATE owner_statements SET state = 'provisional', finalised_at = NULL WHERE owner_id = $1 AND period_start = '2026-10-01'`, OWNER);
r = await unlock('misc', [UNIT]);
check('… and once the owner is no longer final, it unlocks too', r.status === 200 && (r.json?.unlocked ?? []).includes(UNIT), r.text);

// Review Focus 3: Lock all on Revenue skips exactly the units with Airbnb reservations still to confirm and locks the
// rest (a unit with nothing to confirm, as in a month with no Airbnb file, locks). Undone at once: every unit of October.
const incomeBefore = new Set((await db(`SELECT unit_id FROM owner_report_locks WHERE month = $1 AND stage = 'income'`, OCT)).map(x => x.unit_id));
r = await lock('income', 'all');
const lockedIncome = r.json?.locked ?? [];
check('Lock all on Revenue skips the unit still to confirm, names why, and locks the others', r.status === 201
  && !lockedIncome.includes(UNIT) && (r.json?.notReady ?? []).some(x => x.unitId === UNIT && x.reason === '1 Airbnb reservation still to confirm on Airbnb reconciliation.')
  && lockedIncome.length >= 1 && (r.json?.notReady ?? []).every(x => !lockedIncome.includes(x.unitId)), r.text.slice(0, 400));
await unlock('income', lockedIncome.filter(id => !incomeBefore.has(id)));

// Remove everything the check made.
await dropAll();
done();
