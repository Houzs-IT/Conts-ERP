// Recording scanned utility bills (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 4;
// functions/_lib/utilityScan.ts) on a throwaway database (scripts/dev-pglite.mjs: every migration and the demo data).
// Pinned: a page becomes an expense with its period and its page as the receipt; a period crossing the contract start is
// split by days (the SOP example: RM 310 -> RM 40 shared, RM 270 the owner's alone); "Owner paid" gives the full bill
// back; the account learns its marks; a page or a unit/kind/month already recorded is refused; the payment request
// lists only the bills the company pays, at the full bill.
//
// Run: node scripts/api-checks/utility-scan.mjs           (PORT defaults to 55479)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT ?? 55479);
const db = spawn(process.execPath, ['scripts/dev-pglite.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
const url = await new Promise((resolve, reject) => {
  let seen = '';
  db.stdout.on('data', d => { seen += d; const m = /ready: (\S+)/.exec(seen); if (m) resolve(m[1]); });
  db.on('exit', code => reject(new Error(`dev-pglite exited ${code}: ${seen}`)));
});
db.removeAllListeners('exit');

const out = await build({ entryPoints: [join(root, 'functions/_lib/utilityScan.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'utility-scan-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);
const env = { HYPERDRIVE: { connectionString: url } };
process.on('exit', () => db.kill());
process.on('uncaughtException', e => { console.error(e); process.exit(1); });
const sql = postgres(url, { max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' } });

let fails = 0;
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${typeof more === 'string' ? more : JSON.stringify(more)}`}`); };
const session = { userId: (await sql`select id from users order by id limit 1`)[0].id, fullName: 'Check' };
const now = new Date().toISOString();

// Two units with owners and no statements in Aug-Oct 2027; unit A's contract starts 11 Sep 2027.
const [A, B] = await sql`select u.id, u.owner_id from units u where u.parent_unit_id is null and u.owner_id is not null order by u.id limit 2`;
await sql`insert into owner_contracts ${sql({ id: 'chk-scan-a', unit_id: A.id, owner_id: A.owner_id, management_fee_pct: 20, model: 'management', revenue_model: 'management', starts_on: '2027-09-11', ends_on: null, minimum_guarantee: 0, misc_charges: 0, created_at: now })}`;
const page = async () => {
  const id = randomUUID();
  await sql`insert into documents (id, kind, file_name, mime_type, byte_size, storage_key, created_at) values (${id}, 'receipt', 'p.jpg', 'image/jpeg', 10, ${'documents/x/' + id}, ${now})`;
  return id;
};
const BATCH = 'batch-1';
const scan = async (read) => {
  const id = randomUUID();
  await sql`insert into utility_bill_scans (id, batch_id, document_id, model, read, colour, created_by, created_at)
    values (${id}, ${BATCH}, ${await page()}, 'claude-sonnet-5-5', ${sql.json(read)}, 'green', ${session.userId}, ${now})`;
  return id;
};
const READ = { kind: 'electricity', provider: 'TNB', billMonth: '2027-09', accountNoVisible: '2104010945XX02', accountNoFull: null, depositSen: 99838, buildingName: 'Agile', ownerName: 'Tan', meterCurrent: 4410 };

// The SOP example on unit A: RM 310, 15 Aug-14 Sep, contract from 11 Sep.
const s1 = await scan(READ);
// Unit B, the owner paid it, no period printed.
const s2 = await scan({ ...READ, accountNoVisible: '2200118899XX11', depositSen: null, meterCurrent: 812 });
const r = await M.recordScannedBills(env, session, BATCH, [
  { scanId: s1, unitId: A.id, kind: 'electricity', billMonth: '2027-09', periodFrom: '2027-08-15', periodTo: '2027-09-14', amountSen: 31000 },
  { scanId: s2, unitId: B.id, kind: 'electricity', billMonth: '2027-09', amountSen: 4510, ownerPaid: true },
]);
check('two pages recorded', r.ok && r.recorded === 2 && r.ownerLines === 2, r);
check('the save lists what finance pays: TNB, one bill at RM 310 (the owner-paid one is not there)', r.ok && r.toPay.length === 1 && r.toPay[0].provider === 'TNB' && r.toPay[0].count === 1 && r.toPay[0].amountSen === 31000, r.toPay);

const [e1] = await sql`select e.* from expenses e join utility_bill_scans s on s.expense_id = e.id where s.id = ${s1}`;
check('split: the expense keeps the 4 days inside the contract (RM 40)', e1?.amount === 4000 && !e1.record_only, e1);
check('the expense keeps its period and its page as the receipt', e1?.period_from === '2027-08-15' && e1?.period_to === '2027-09-14' && !!e1?.receipt_document_id, e1);
const [doc1] = await sql`select unit_id from documents where id = ${e1?.receipt_document_id ?? ''}`;
check('the page, uploaded with no unit, becomes the receipt of its unit once recorded', doc1?.unit_id === A.id, doc1);
check('the deduction month is the bill month (nothing final)', e1?.deduct_month === '2027-09', e1?.deduct_month);
const adj1 = await sql`select * from owner_adjustments where expense_id = ${e1?.id}`;
check("split: RM 270 the owner's alone, as an open O2 charge on the bill's month", adj1.length === 1 && adj1[0].amount === -27000 && adj1[0].kind === 'charge' && adj1[0].state === 'open' && adj1[0].owner_id === A.owner_id && adj1[0].occurred_on === '2027-09-01', adj1);

const [e2] = await sql`select e.* from expenses e join utility_bill_scans s on s.expense_id = e.id where s.id = ${s2}`;
const adj2 = await sql`select * from owner_adjustments where expense_id = ${e2?.id}`;
check('owner paid: the bill is recorded whole and the full RM 45.10 goes back as an O2 credit', e2?.amount === 4510 && adj2.length === 1 && adj2[0].amount === 4510 && adj2[0].kind === 'credit', { e2, adj2 });

const marks = await sql`select m.* from utility_account_marks m join unit_utility_accounts a on a.id = m.account_id where a.unit_id = ${A.id} and a.kind = 'electricity'`;
check('the account learns its marks (pattern, deposit, meter, month)', marks.length === 1 && marks[0].account_no_pattern === '2104010945XX02' && marks[0].deposit_sen === 99838 && Number(marks[0].last_meter_reading) === 4410 && marks[0].last_bill_month === '2027-09', marks);
const accA = await sql`select account_no from unit_utility_accounts where unit_id = ${A.id} and kind = 'electricity'`;
check('a unit with no account of the kind gets one, never with an empty number', accA.length >= 1 && accA.every(a => a.account_no), accA);

// Next month's page for unit A matches green from the marks alone.
const { accounts } = await M.scanContext(env);
const { matchBill } = await import(pathToFileURL(join(root, 'src/lib/utilityMatch.ts')).href);
const m2 = matchBill({ ...READ, billMonth: '2027-10', currentChargesSen: 30000, meterPrevious: 4410 }, accounts, []);
check("next month's page matches unit A green from what it learnt", m2.colour === 'green' && accounts.find(a => a.accountId === m2.accountId)?.unitId === A.id, m2);

// The same save again (its answer was lost): nothing is written twice, and it still says what finance pays.
const again = await M.recordScannedBills(env, session, BATCH, [
  { scanId: s1, unitId: A.id, kind: 'electricity', billMonth: '2027-09', periodFrom: '2027-08-15', periodTo: '2027-09-14', amountSen: 31000 },
  { scanId: s2, unitId: B.id, kind: 'electricity', billMonth: '2027-09', amountSen: 4510, ownerPaid: true },
]);
const counts = await sql`select (select count(*)::int from expenses e join utility_bill_scans s on s.expense_id = e.id where s.batch_id = ${BATCH}) e, (select count(*)::int from owner_adjustments where expense_id is not null) a`;
check('the same save again records nothing twice and still lists what finance pays', again.ok && again.recorded === 0 && again.alreadyDone === 2 && again.toPay.length === 1 && again.toPay[0].amountSen === 31000 && counts[0].e === 2 && counts[0].a === 2, { again, counts });
const s3 = await scan(READ);
const twin = await M.recordScannedBills(env, session, BATCH, [{ scanId: s3, unitId: A.id, kind: 'electricity', billMonth: '2027-09', amountSen: 31000 }]);
check('another page for the same unit, kind and month is refused', !twin.ok && twin.code === 'ALREADY_RECORDED', twin);
const bad = await M.recordScannedBills(env, session, BATCH, [{ scanId: s3, unitId: A.id, kind: 'electricity', billMonth: '2027-10', amountSen: 0 }]);
check('no amount is refused before anything is written', !bad.ok && bad.status === 422, bad);

// A bill wholly before the contract: kept record-only, the whole bill the owner's.
const s4 = await scan({ ...READ, billMonth: '2027-08' });
const r4 = await M.recordScannedBills(env, session, BATCH, [{ scanId: s4, unitId: A.id, kind: 'electricity', billMonth: '2027-08', periodFrom: '2027-07-15', periodTo: '2027-08-14', amountSen: 9000 }]);
const [e4] = await sql`select e.* from expenses e join utility_bill_scans s on s.expense_id = e.id where s.id = ${s4}`;
const adj4 = await sql`select amount from owner_adjustments where expense_id = ${e4?.id}`;
check('wholly before the contract: record-only, the whole RM 90 an O2 charge', r4.ok && e4?.record_only === true && adj4.length === 1 && adj4[0].amount === -9000, { r4, e4, adj4 });

// The payment request: only the bills the company pays, at the full bill.
const pay = await M.billsToPay(env, BATCH, [s1, s2, s4]);
check('to pay: TNB, the split bill at its full RM 310 and the August one; not the one the owner paid', pay.length === 1 && pay[0].provider === 'TNB' && pay[0].bills.map(b => b.amountSen).sort().join() === '31000,9000' && pay[0].bills.every(b => b.unitId === A.id) && pay[0].scanIds.sort().join() === [s1, s4].sort().join(), pay);

// A unit with two meters of one kind: each page names its account, and both bills of the month go in.
const [meter1, meter2] = [randomUUID(), randomUUID()];
await sql`insert into unit_utility_accounts (id, unit_id, kind, account_no, provider, created_at, updated_at) values
  (${meter1}, ${B.id}, 'electricity', '220011889911', 'TNB', ${now}, ${now}), (${meter2}, ${B.id}, 'electricity', '220011889922', 'TNB', ${now}, ${now})`;
const [t1, t2] = [await scan({ ...READ, billMonth: '2027-10' }), await scan({ ...READ, billMonth: '2027-10' })];
const two = await M.recordScannedBills(env, session, BATCH, [
  { scanId: t1, unitId: B.id, accountId: meter1, kind: 'electricity', billMonth: '2027-10', amountSen: 1000 },
  { scanId: t2, unitId: B.id, accountId: meter2, kind: 'electricity', billMonth: '2027-10', amountSen: 2000 },
]);
const refs = await sql`select reference from expenses where unit_id = ${B.id} and category = 'electricity' and incurred_on like '2027-10%' order by reference`;
check('two meters on one unit: both bills of the month are recorded, each on its account', two.ok && refs.map(r => r.reference).join() === '220011889911,220011889922', { two, refs });

// The kind corrected by hand: a page read as a TNB electricity bill but recorded as water is not a TNB bill.
const w = await scan({ ...READ, billMonth: '2027-11' });
const rw = await M.recordScannedBills(env, session, BATCH, [{ scanId: w, unitId: B.id, kind: 'water', billMonth: '2027-11', amountSen: 3000 }]);
check('a kind corrected by hand: the provider is not taken from the misread page', rw.ok && rw.toPay.length === 1 && rw.toPay[0].provider !== 'TNB', rw);

// The owner lines go on the unit's owner, the same owner whose statement carries the bill.
const adjOwners = await sql`select distinct a.owner_id from owner_adjustments a join expenses e on e.id = a.expense_id where e.unit_id = ${A.id}`;
check("owner lines are on the unit's owner", adjOwners.length === 1 && adjOwners[0].owner_id === A.owner_id, adjOwners);

// Payment requests keep their bills (chew, 5 Nov 2026; SOP 3.10; functions/_lib/utilityRequests.ts, migration 0219).
const outR = await build({ entryPoints: [join(root, 'functions/_lib/utilityRequests.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
writeFileSync(join(tmp, 'r.mjs'), outR.outputFiles[0].text);
const R = await import(pathToFileURL(join(tmp, 'r.mjs')).href);
check('a scanned bill keeps its "Owner paid this bill" tick on the expense', e2?.owner_paid === true && e1?.owner_paid === false, { e1: e1?.owner_paid, e2: e2?.owner_paid });
check('the save names the bills it sends for payment', pay[0]?.expenseIds?.length === 2 && pay[0].expenseIds.includes(e1?.id) && pay[0].expenseIds.includes(e4?.id), pay[0]?.expenseIds);
const groups = await R.billsToRequest(env, [e1.id, e2.id, e4.id]);
check('to request: TNB, the two bills the company pays at their full bills (RM 310 split, RM 90 record only); not the one the owner paid', groups.length === 1 && groups[0].provider === 'TNB' && groups[0].bills.map(b => b.expenseId).sort().join() === [e1.id, e4.id].sort().join() && groups[0].bills.map(b => b.amountSen).sort().join() === '31000,9000', groups);
check('the request key is the same whatever the order of the bills', await R.requestKey([e1.id, e4.id]) === await R.requestKey([e4.id, e1.id]));
check('the request key differs for other bills', await R.requestKey([e1.id]) !== await R.requestKey([e1.id, e4.id]));
const linked = await R.linkRequest(env, [e1.id, e4.id], { id: 'req-1', requestNo: 'PRQ-2711-001' });
const relinked = await R.linkRequest(env, [e1.id], { id: 'req-2', requestNo: 'PRQ-2711-002' });
const [l1] = await sql`select payment_request_id, payment_request_no from expenses where id = ${e1.id}`;
check('each bill keeps the request it went out on, and a later one does not take it over', linked === 2 && relinked === 0 && l1.payment_request_id === 'req-1' && l1.payment_request_no === 'PRQ-2711-001', { linked, relinked, l1 });
check('a bill already on a request is not sent again', (await R.billsToRequest(env, [e1.id, e4.id])).length === 0);
// A bill with no account provider goes under its kind's name.
const loose = randomUUID();
await sql`insert into expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, charge_to, created_at) values (${loose}, ${B.id}, 'sewerage', 'IWK', 2400, 'MYR', '2027-09-30', '2027-09', 'owner', ${now})`;
const iwk = await R.billsToRequest(env, [loose]);
check('a bill with no account provider goes under its kind: Indah Water', iwk.length === 1 && iwk[0].provider === 'Indah Water' && iwk[0].bills[0].amountSen === 2400, iwk);
// A request sent back (chew, 13 Nov 2026: change it and send it again): "Send again" sends the bills still on it that the
// company pays, at their full bills, and lets go of one the owner now pays.
const on1 = await R.billsOnRequest(env, 'req-1');
check('the bills on a request, at their full bills', on1.bills.map(b => b.expenseId).sort().join() === [e1.id, e4.id].sort().join() && on1.bills.map(b => b.amountSen).sort().join() === '31000,9000' && on1.off.length === 0, on1);
await sql`update expenses set owner_paid = true where id = ${e4.id}`;
const on1b = await R.billsOnRequest(env, 'req-1');
check('a bill now paid by the owner is no longer sent, and is named to let go', on1b.bills.map(b => b.expenseId).join() === e1.id && on1b.off.join() === e4.id, on1b);
const let1 = await R.unlinkRequest(env, on1b.off);
const [l4] = await sql`select payment_request_id, payment_request_no from expenses where id = ${e4.id}`;
check('let go: the bill keeps no request', let1 === 1 && l4.payment_request_id === null && l4.payment_request_no === null, { let1, l4 });
check('a request with no bills has nothing to send', (await R.billsOnRequest(env, 'req-none')).bills.length === 0);

await sql.end();
db.kill();
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
