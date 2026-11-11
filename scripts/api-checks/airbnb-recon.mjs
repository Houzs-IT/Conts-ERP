// Airbnb reconciliation, step 2 (chew, 11 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md).
// Confirming a reservation's line writes what the confirm window listed, together or not at all, and undo puts it
// back while the statements it touched are open:
//   - an extension paid in parts sets the guest total so the net is Airbnb's (the fee stays); with October's owner
//     statement final, the owner's share goes on November's as an open owner adjustment (source airbnb_recon);
//   - company income takes the type chosen, else the one the rules propose; Additional charge needs its sub-type;
//   - lines that only record company income are confirmed together, anything else one by one;
//   - a stay still to come is never cancelled from here; Keep as it is writes the decision only;
//   - undo is refused once a final statement carries the owner's share;
//   - finance keeps the income types: added, given words, made inactive (the rules then leave the type to choose).
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55441/postgres API_BASE=http://localhost:8788 node scripts/api-checks/airbnb-recon.mjs
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const MONTH = '2026-10';

let r = await call('GET', `/api/airbnb-recon?month=${MONTH}`);
check('the month reads, with confirming set up (migration 0259)', r.status === 200 && r.json?.ready === true && r.json?.confirmReady === true, r.text.slice(0, 300));
check('the month says how much of its income is locked (Owner statement close)',
  Number.isInteger(r.json?.incomeLocks?.locked) && Number.isInteger(r.json?.incomeLocks?.total) && r.json.incomeLocks.locked <= r.json.incomeLocks.total, JSON.stringify(r.json?.incomeLocks));
if (!r.json?.confirmReady) done();

// Two profit-share units of different owners whose October and November 2026 statements are not final yet (a draft is
// fine: generating rebuilds it; the checks before this one in CI leave drafts for those months, unit-costs.mjs):
// a management contract with no minimum, or no contract and no split of its own (the default operator share), as the
// statements read them (termsFor). Owners with no statement in those months first.
const units = await db(`SELECT u.id, u.owner_id, c.management_fee_pct AS fee FROM units u LEFT JOIN owner_contracts c ON c.id = u.contract_id
  WHERE u.parent_unit_id IS NULL AND coalesce(c.model, 'management') = 'management' AND coalesce(c.minimum_guarantee, 0) = 0
    AND (c.id IS NOT NULL OR coalesce(u.split_kind, '') !~* 'grr|guaranteed rent|profit share')
    AND NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = u.owner_id AND substr(s.period_start, 1, 7) IN ('2026-10', '2026-11')
                      AND s.state IN ('finalised', 'sent', 'paid'))
  ORDER BY (SELECT count(*) FROM owner_statements s WHERE s.owner_id = u.owner_id AND substr(s.period_start, 1, 7) IN ('2026-10', '2026-11')), u.id`);
const u1 = units[0];
const u2 = units.find(u => u.owner_id !== u1?.owner_id);
check('two profit-share units of different owners, October and November not final', !!u1 && !!u2, `${units.length} units`);
if (!u1 || !u2) done();
const [setting] = await db(`SELECT coalesce((SELECT value FROM settings WHERE key = 'locale.managementFeePct'), (SELECT value FROM settings WHERE key = 'finance.default_fee_pct'), '25') AS fee`);

const now = new Date().toISOString();
const stay = (id, unitId, code, checkIn, checkOut, gross, fee, state = 'checked_out') => db(`
  INSERT INTO reservations (id, unit_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at)
  VALUES ($1, $2, 'airbnb', $3, $4, $5, $6, 2, $7, $8, 0, $9, $9)`, id, unitId, code, state, checkIn, checkOut, gross, fee, now);
// HMQFZYBTXQ's figures (chew's spec): RM 281.96 guest total, RM 44.25 fee; Airbnb paid 237.71 then 59.95.
await stay('rc-set', u1.id, 'HMCHECK0SET', '2026-10-26', '2026-10-30', 28_196, 4_425);
await stay('rc-air', u2.id, 'HMCHECK0AIR', '2026-10-02', '2026-10-05', 50_000, 0);
await stay('rc-ar2', u2.id, 'HMCHECK0AR2', '2026-10-06', '2026-10-07', 20_000, 0);
await stay('rc-add', u2.id, 'HMCHECK0ADD', '2026-10-08', '2026-10-10', 30_000, 0);
await stay('rc-kep', u2.id, 'HMCHECK0KEP', '2026-10-12', '2026-10-14', 20_000, 3_000);
await stay('rc-pik', u2.id, 'HMCHECK0PIK', '2026-10-19', '2026-10-21', 30_000, 0);
await stay('rc-fut', u2.id, 'HMCHECK0FUT', '2026-11-20', '2026-11-23', 30_000, 0, 'confirmed');

// October's statement for u1's owner is final before the files come.
const statementOf = async (ownerId, month) => (await db(`SELECT id, state FROM owner_statements WHERE owner_id = $1 AND period_start LIKE $2`, ownerId, `${month}%`))[0];
r = await call('POST', '/api/statements/generate', { period: MONTH, ownerIds: [u1.owner_id] });
check('October statement generated', r.status < 300, r.text);
r = await call('POST', '/api/statements/finalise', { statementIds: [(await statementOf(u1.owner_id, MONTH))?.id] });
check('October statement final', r.status === 200 && (await statementOf(u1.owner_id, MONTH))?.state !== 'provisional', r.text);

const line = (date, type, code, amount, o = {}) => ({
  Date: date, Type: type, 'Confirmation code': code, 'Start date': o.start ?? '', 'End date': o.end ?? '', Nights: o.nights ?? '', Guest: 'Check Guest',
  Listing: 'Check listing', Details: o.details ?? '', 'Reference code': '', Currency: 'MYR', Amount: amount, 'Paid out': '',
});
const rows = [
  line('10/27/2026', 'Reservation', 'HMCHECK0SET', '237.71', { start: '10/26/2026', end: '10/30/2026', nights: '4' }),
  line('10/28/2026', 'Reservation', 'HMCHECK0SET', '59.95', { start: '10/26/2026', end: '10/30/2026', nights: '4' }),
  line('10/20/2026', 'Resolution Payout', 'HMCHECK0AIR', '99.99', { details: 'AirCover damage reimbursement for resolution CLSF-1' }),
  line('10/20/2026', 'Resolution Payout', 'HMCHECK0AR2', '20.00', { details: 'AirCover damage reimbursement for resolution CLSF-2' }),
  line('10/21/2026', 'Resolution Payout', 'HMCHECK0ADD', '50.00', { details: 'Resolution payout for resolution CLA-9' }),
  line('10/22/2026', 'Resolution Payout', 'HMCHECK0PIK', '80.00', { details: 'Resolution payout for airport pickup CLA-7' }),
  line('10/13/2026', 'Reservation', 'HMCHECK0KEP', '190.00', { start: '10/12/2026', end: '10/14/2026', nights: '2' }),
  line('10/15/2026', 'Reservation', 'HMCHECK0FUT', '300.00', { start: '11/20/2026', end: '11/23/2026', nights: '3' }),
  line('10/16/2026', 'Adjustment', 'HMCHECK0FUT', '-300.00', { start: '11/20/2026', end: '11/23/2026', nights: '3' }),
];
r = await call('POST', '/api/airbnb-recon/upload', { month: MONTH, files: [{ name: 'airbnb-check.csv', rows }] });
check('the Airbnb file uploads', r.status < 300 && r.json?.added === rows.length, r.text);

const month = async () => (await call('GET', `/api/airbnb-recon?month=${MONTH}`)).json;
const lineOf = (m, code) => m?.lines?.find(l => l.code === code);
let m = await month();
const set = lineOf(m, 'HMCHECK0SET');
check('an extension paid in parts sets the reservation to Airbnb’s RM 297.66', set?.rule === 'R7' && set?.action === 'set_amount' && set?.newAmount === 29_766, JSON.stringify(set)?.slice(0, 300));
check('the window lists the guest total moving, the fee staying', set?.preview?.ok && set.preview.changes[0]?.gross.before === 28_196 && set.preview.changes[0]?.gross.after === 34_191 && set.preview.changes[0]?.fee === 4_425,
  JSON.stringify(set?.preview));
const pct = 100 - Number(u1.fee ?? setting.fee);
const share = Math.round(5_995 * pct / 100);
check(`October final: the owner’s ${pct}% of RM 59.95 goes on November`, set?.preview?.shares?.length === 1 && set.preview.shares[0].sen === share && set.preview.shares[0].onMonth === '2026-11',
  JSON.stringify(set?.preview?.shares));
check('a line that changes a reservation is not for confirming together', set?.bulk === false);
const air = lineOf(m, 'HMCHECK0AIR');
check('AirCover only: AirCover, confirmed together', air?.rule === 'R13' && air?.bulk === true && air?.income?.[0]?.proposed?.typeId === 'ait-aircover', JSON.stringify(air)?.slice(0, 300));
const add = lineOf(m, 'HMCHECK0ADD');
check('a resolution payout is an Additional charge whose sub-type finance chooses', add?.income?.[0]?.proposed?.typeId === 'ait-additional' && !add.income[0].proposed.subTypeId && add.bulk === false,
  JSON.stringify(add?.income));
const fut = lineOf(m, 'HMCHECK0FUT');
check('a fully refunded stay still to come is not cancelled from here', fut?.rule === 'R3' && fut?.preview?.ok === false && /still to come/.test(fut.preview.message ?? ''), JSON.stringify(fut?.preview));

// Confirming together: only lines that just record company income.
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0AIR', decision: 'confirm' }, { code: 'HMCHECK0SET', decision: 'confirm' }] });
check('confirming together refuses a line that changes a reservation, and writes none', r.status === 422 && /on its own/.test(r.text), r.text);
check('… none was written', !(await db(`SELECT 1 FROM airbnb_recon_decisions WHERE code = 'HMCHECK0AIR'`)).length);
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0AIR', decision: 'confirm' }] });
check('an AirCover line confirms', r.status === 200 && r.json?.confirmed === 1 && r.json?.income === 9_999 && r.json?.reservations === 0, r.text);
let inc = await db(`SELECT i.type_id, i.sub_type_id, i.amount, i.unit_id, d.action FROM airbnb_company_income i JOIN airbnb_recon_decisions d ON d.id = i.decision_id WHERE i.code = 'HMCHECK0AIR'`);
check('… as AirCover company income, tied to its decision', inc.length === 1 && inc[0].type_id === 'ait-aircover' && Number(inc[0].amount) === 9_999 && inc[0].unit_id === u2.id, JSON.stringify(inc));

// Additional charge needs its sub-type.
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0ADD', decision: 'confirm' }] });
check('an Additional charge without its sub-type is refused', r.status === 422 && /kind of Additional charge/.test(r.text), r.text);
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0ADD', decision: 'confirm', income: [{ key: add.income[0].key, typeId: 'ait-additional', subTypeId: 'ait-pickup' }] }] });
check('with Pickup it confirms', r.status === 200, r.text);
inc = await db(`SELECT type_id, sub_type_id FROM airbnb_company_income WHERE code = 'HMCHECK0ADD'`);
check('… recorded as Additional charge · Pickup', inc[0]?.type_id === 'ait-additional' && inc[0]?.sub_type_id === 'ait-pickup', JSON.stringify(inc));

// A stay to come is cancelled on the reservation, never here.
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0FUT', decision: 'confirm' }] });
check('cancelling a stay to come is refused', r.status === 422 && /still to come/.test(r.text), r.text);
check('… and it stays confirmed', (await db(`SELECT state FROM reservations WHERE id = 'rc-fut'`))[0]?.state === 'confirmed');

// The extension: the reservation, the owner's share on November, the decision; then undo, and again.
const resv = async id => (await db(`SELECT gross_booking_value AS gross, channel_fee AS fee, state FROM reservations WHERE id = $1`, id))[0];
const shares = () => db(`SELECT id, kind, amount, occurred_on, reference, state, source, statement_id FROM owner_adjustments WHERE source = 'airbnb_recon' AND reference = 'HMCHECK0SET'`);
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0SET', decision: 'confirm', note: 'Extended a day' }] });
check('the extension confirms', r.status === 200 && r.json?.reservations === 1 && r.json?.ownerShares?.[0]?.amount === share && r.json?.ownerShares?.[0]?.onMonth === '2026-11', r.text);
let now1 = await resv('rc-set');
check('… the guest total is RM 341.91, the fee stays RM 44.25', Number(now1.gross) === 34_191 && Number(now1.fee) === 4_425, JSON.stringify(now1));
let adj = await shares();
check('… the owner’s share is an open credit on 1 Nov', adj.length === 1 && adj[0].kind === 'credit' && Number(adj[0].amount) === share && adj[0].occurred_on === '2026-11-01' && adj[0].state === 'open', JSON.stringify(adj));
check('… with an owner-readable line', /^Airbnb reservation HMCHECK0SET: amount corrected after the Oct 2026 statement$/.test((await db(`SELECT description FROM owner_adjustments WHERE id = $1`, adj[0]?.id))[0]?.description ?? ''));
check('… and the audit trail', (await db(`SELECT action FROM audit_log WHERE action IN ('airbnb_recon.confirm', 'reservation.airbnb_amount') AND (after_state LIKE '%HMCHECK0SET%')`)).length === 2);
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0SET', decision: 'confirm' }] });
check('confirming it twice is refused', r.status === 422 && /already confirmed/.test(r.text), r.text);
m = await month();
check('the month shows it confirmed, with what it wrote', lineOf(m, 'HMCHECK0SET')?.decision?.action === 'set_amount' && lineOf(m, 'HMCHECK0SET')?.decision?.note === 'Extended a day'
  && lineOf(m, 'HMCHECK0SET')?.decision?.ownerShares?.[0]?.sen === share, JSON.stringify(lineOf(m, 'HMCHECK0SET')?.decision));

r = await call('POST', '/api/airbnb-recon/undo', { month: MONTH, code: 'HMCHECK0SET' });
check('undo while November is open', r.status === 200, r.text);
now1 = await resv('rc-set');
check('… the guest total is back to RM 281.96', Number(now1.gross) === 28_196, JSON.stringify(now1));
check('… the owner’s share is gone, and the decision', !(await shares()).length && !(await db(`SELECT 1 FROM airbnb_recon_decisions WHERE code = 'HMCHECK0SET'`)).length);

r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0SET', decision: 'confirm' }] });
check('it confirms again', r.status === 200, r.text);
r = await call('POST', '/api/statements/generate', { period: '2026-11', ownerIds: [u1.owner_id] });
const nov = await statementOf(u1.owner_id, '2026-11');
adj = await shares();
check('November’s statement takes the owner’s share', r.status < 300 && !!nov && adj[0]?.statement_id === nov.id, `${r.text} ${JSON.stringify(adj)}`);
const novLines = await db(`SELECT amount FROM statement_lines WHERE statement_id = $1 AND adjustment_id = $2`, nov?.id, adj[0]?.id);
check('… as a line of its own', novLines.length === 1 && Number(novLines[0].amount) === share, JSON.stringify(novLines));
r = await call('POST', '/api/statements/finalise', { statementIds: [nov?.id] });
check('November final', r.status === 200, r.text);
r = await call('POST', '/api/airbnb-recon/undo', { month: MONTH, code: 'HMCHECK0SET' });
check('then undo is refused', r.status === 409 && /final statement/.test(r.text), r.text);
check('… and nothing moved', Number((await resv('rc-set')).gross) === 34_191 && (await shares()).length === 1);

// Keep as it is: the decision only.
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0KEP', decision: 'keep', note: 'Guest paid the difference in cash' }] });
check('keep as it is', r.status === 200 && r.json?.kept === 1 && r.json?.reservations === 0, r.text);
check('… the reservation is unchanged', Number((await resv('rc-kep')).gross) === 20_000);
check('… the month shows it kept', lineOf(await month(), 'HMCHECK0KEP')?.decision?.action === 'keep');
r = await call('POST', '/api/airbnb-recon/undo', { month: MONTH, code: 'HMCHECK0KEP' });
check('… and undoes', r.status === 200 && !(await db(`SELECT 1 FROM airbnb_recon_decisions WHERE code = 'HMCHECK0KEP'`)).length, r.text);

// Income types, kept by finance.
r = await call('POST', '/api/airbnb-recon/income-types', { parentId: 'ait-additional', name: 'Laundry', matchWords: 'laundry' });
check('a sub-type is added', r.status === 200 && /^ait-/.test(r.json?.id ?? ''), r.text);
r = await call('POST', '/api/airbnb-recon/income-types', { parentId: 'ait-additional', name: 'laundry' });
check('the same name twice under a type is refused', r.status === 422, r.text);
r = await call('POST', '/api/airbnb-recon/income-types', { parentId: r.json?.id ?? 'ait-pickup', name: 'Too deep' });
check('a sub-type of a sub-type is refused', r.status === 422, r.text);
check('… before the words, the pickup payout waits for its sub-type', lineOf(await month(), 'HMCHECK0PIK')?.bulk === false);
r = await call('POST', '/api/airbnb-recon/income-types', { id: 'ait-pickup', name: 'Pickup', matchWords: 'airport, pickup' });
check('words are given to Pickup', r.status === 200, r.text);
m = await month();
const pik = lineOf(m, 'HMCHECK0PIK');
check('… and a payout whose Details say “airport pickup” starts as Additional charge · Pickup', pik?.income?.[0]?.proposed?.typeId === 'ait-additional' && pik.income[0].proposed.subTypeId === 'ait-pickup' && pik.bulk === true,
  JSON.stringify(pik?.income));
r = await call('POST', '/api/airbnb-recon/income-types', { id: 'ait-aircover', name: 'AirCover', matchWords: 'AirCover', active: false });
check('AirCover made inactive', r.status === 200, r.text);
const ar2 = lineOf(await month(), 'HMCHECK0AR2');
check('… an AirCover line then waits for finance to choose', ar2?.income?.[0]?.proposed?.typeId === null && ar2?.bulk === false, JSON.stringify(ar2?.income));
r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0AR2', decision: 'confirm', income: [{ key: ar2?.income?.[0]?.key, typeId: 'ait-aircover' }] }] });
check('… and an inactive type cannot be chosen', r.status === 422 && /inactive/.test(r.text), r.text);
r = await call('POST', '/api/airbnb-recon/income-types', { id: 'ait-aircover', name: 'AirCover', matchWords: 'AirCover', active: true });
check('AirCover active again', r.status === 200 && lineOf(await month(), 'HMCHECK0AR2')?.income?.[0]?.proposed?.typeId === 'ait-aircover', r.text);

r = await call('POST', '/api/airbnb-recon/decisions', { month: MONTH, items: [{ code: 'HMCHECK0PIK', decision: 'confirm' }] }, 'finance_admin');
check('confirming needs access to Airbnb reconciliation', r.status === 403, r.text);
done();
