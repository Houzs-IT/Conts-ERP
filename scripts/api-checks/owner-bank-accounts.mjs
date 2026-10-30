// Several bank accounts per owner (migration 0180): the owner accounts API, a unit's "pays to" choice, the payout
// transfer file split by account, the bank test when a statement is sent, the statement PDF and portal tails, and the
// workbook import's choice of main account.
// Throwaway database only; it calls the handlers directly, so no dev server is needed:
//   1. PORT=55461 node scripts/dev-pglite.mjs            (leave it running; it applies every migration and seeds the demo users)
//   2. node scripts/api-checks/owner-bank-accounts.mjs [postgres://pos_app:local@127.0.0.1:55461/postgres]
// Account numbers below are made up. Nothing here prints one.
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const url = process.argv[2] ?? 'postgres://pos_app:local@127.0.0.1:55461/postgres';
if (!/@(127\.0\.0\.1|localhost):/.test(url)) { console.error('Refused: local database only.'); process.exit(2); }
process.env.SESSION_SECRET ??= 'smoke-test-secret-not-real-0123456789';
const { cookieFor, check, done } = await import('./harness.mjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = ['db:_lib/db.ts', 'bank:_lib/ownerBank.ts', 'imp:_lib/hostplatformImport.ts', 'impDb:_lib/hostplatformImportDb.ts',
  'accounts:api/owners/[id]/accounts/index.ts', 'account:api/owners/[id]/accounts/[accountId].ts', 'reveal:api/owners/[id]/accounts/[accountId]/reveal.ts',
  'unitBank:api/units/[id]/bank-account.ts', 'unitPatch:api/units/[id].ts', 'unitDetail:api/units/detail.ts',
  'payoutExport:api/payouts/export.ts', 'payouts:api/payouts/index.ts', 'send:api/statements/send.ts', 'pdf:api/statements/pdf.ts', 'summary:api/owner/summary.ts',
].map(e => { const [name, path] = e.split(':'); return `export * as ${name} from './functions/${path}';`; }).join('\n');
const out = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'owner-bank-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

const env = { HYPERDRIVE: { connectionString: url }, SESSION_SECRET: process.env.SESSION_SECRET };
const { all, one, run } = M.db;
const tag = Date.now().toString(36);
const now = new Date().toISOString();

/** One handler call as a signed-in role: { status, json, text }. */
async function call(mod, method, path, { params = {}, body, role = 'management' } = {}) {
  const request = new Request('http://local.test' + path, { method, headers: { cookie: cookieFor(role), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const handler = mod[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const res = await handler({ request, env, params, data: {}, waitUntil() {}, next() {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

/* ---------- the pure pieces ---------- */
const pick = (ownerId, unitId, account) => ({ ownerId, unitId, account, bankName: 'B', holder: null, label: 'L' });
{
  const a = M.imp.planOwnerBanks([pick('o', 'u1', '111111'), pick('o', 'u2', '222222'), pick('o', 'u3', '222222')]);
  check('plan: the account most units use is the main', a.mains.get('o')?.account === '222222' && a.extras.length === 1 && a.extras[0].unitId === 'u1');
  const t = M.imp.planOwnerBanks([pick('o', 'u1', '111 111'), pick('o', 'u2', '222222')]);
  check('plan: a tie goes to the first row', t.mains.get('o')?.account === '111 111' && t.extras.map(x => x.unitId).join() === 'u2');
  const same = M.imp.planOwnerBanks([pick('o', 'u1', '1111-11'), pick('o', 'u2', '111 111')]);
  check('plan: spaces and dashes do not make a different account', same.extras.length === 0);
  const kept = M.imp.planOwnerBanks([pick('o', 'u1', '111111'), pick('o', 'u2', '111111')], new Map([['o', '999999']]));
  check('plan: an owner whose stored main is kept gets an extra for every other number', kept.mains.size === 0 && kept.extras.length === 2);
  const v = M.bank.parseAccountInput({ bankName: 'Maybank', accountNumber: '1234 5678 90', accountHolder: 'A' }, true);
  check('input: a good account', !Object.keys(v.fields).length && v.set.accountNumber === '1234 5678 90' && v.set.label === null);
  const bad = M.bank.parseAccountInput({ bankName: '', accountNumber: 'abc', accountHolder: 'x'.repeat(121), label: 'y'.repeat(61) }, true);
  check('input: bad bank, number, holder and label are all named', ['bankName', 'accountNumber', 'accountHolder', 'label'].every(k => bad.fields[k]), JSON.stringify(bad.fields));
  const keep = M.bank.parseAccountInput({ accountNumber: '••••1234' }, false);
  check('input: a masked number on an edit keeps the stored one', !Object.keys(keep.fields).length && keep.set.accountNumber === undefined);
  check('input: a masked number on a new account is refused', !!M.bank.parseAccountInput({ bankName: 'B', accountNumber: '••••1234' }, true).fields.accountNumber);
}

/* ---------- test data ---------- */
let seq = 0;
const newOwner = async (key, main) => {
  const id = `t-own-${key}-${tag}`;
  await run(env, `INSERT INTO owners (id, display_name, email, bank_name, bank_account_number, bank_account_last4, bank_account_holder, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, `Owner ${key} ${tag}`, `${id}@example.com`, main ? 'Maybank' : null, main ?? null, main ? main.slice(-4) : null, main ? `Holder ${key}` : null, now, now);
  return id;
};
const newBuilding = async key => {
  const id = `t-prop-${key}-${tag}`;
  await run(env, 'INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, `Tower ${key} ${tag}`, 'Jalan 1', 'KL', 'WP', now, now);
  return id;
};
const newUnit = async (key, propertyId, ownerId) => {
  const id = `t-unit-${key}-${tag}`;
  await run(env, 'INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)', id, propertyId, ownerId, key, now, now);
  return id;
};
/** A statement with one line per [unitId, sen], and a payout of `payout` sen (default: the lines added up). */
const newStatement = async (ownerId, lines, { state = 'finalised', payout, withPayout = true } = {}) => {
  const id = `t-stm-${ownerId}`, total = lines.reduce((n, [, sen]) => n + sen, 0);
  await run(env, `INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, net_payout, generated_at, created_at) VALUES (?, ?, '2031-03-01', '2031-03-31', ?, ?, ?, ?)`, id, ownerId, state, payout ?? total, now, now);
  for (const [unitId, sen] of lines) await run(env, `INSERT INTO statement_lines (id, statement_id, unit_id, line_type, description, occurred_on, amount) VALUES (?, ?, ?, 'gross', 'Income', '2031-03-31', ?)`, `${id}-${++seq}`, id, unitId, sen);
  let payoutId = null;
  if (withPayout) {
    payoutId = `t-pay-${ownerId}`;
    await run(env, `INSERT INTO payouts (id, statement_id, owner_id, amount, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`, payoutId, id, ownerId, payout ?? total, now);
  }
  return { id, payoutId };
};
const addAccount = async (ownerId, body, role) => call(M.accounts, 'POST', `/api/owners/${ownerId}/accounts`, { params: { id: ownerId }, body, role });
const setPaysTo = (unitId, accountId, role) => call(M.unitBank, 'PATCH', `/api/units/${unitId}/bank-account`, { params: { id: unitId }, body: { accountId }, role });
const exportRows = async payoutIds => {
  const r = await call(M.payoutExport, 'GET', `/api/payouts/export?ids=${payoutIds.join(',')}`);
  return { ...r, rows: r.json?.data ?? [] };
};

const MAIN_A = '1000000001', X1 = '2000000002', X2 = '3000000003';
const ownerA = await newOwner('a', MAIN_A), ownerB = await newOwner('b', '5000000005');
const p1 = await newBuilding('1'), p2 = await newBuilding('2');
const uA1 = await newUnit('A-01', p1, ownerA), uA2 = await newUnit('A-02', p1, ownerA), uA3 = await newUnit('B-01', p2, ownerA);

/* ---------- owner accounts API ---------- */
let r = await addAccount(ownerA, { label: 'Tower 1', bankName: 'CIMB', accountNumber: X1, accountHolder: 'Holder A' });
check('add an account', r.status === 201 && typeof r.json?.id === 'string', r.text);
const acc1 = r.json?.id;
r = await addAccount(ownerA, { bankName: 'Hong Leong', accountNumber: X2, accountHolder: 'Holder A' });
const acc2 = r.json?.id;
check('add a second account (no label)', r.status === 201 && !!acc2, r.text);
r = await addAccount(ownerB, { bankName: 'Public Bank', accountNumber: '6000000006', accountHolder: 'Holder B' });
const accB = r.json?.id;

r = await addAccount(ownerA, { bankName: '', accountNumber: 'abc', accountHolder: 'x' });
check('a bad account gets 422 with the fields named', r.status === 422 && r.json?.error?.code === 'VALIDATION' && r.json.error.fields?.bankName && r.json.error.fields?.accountNumber, r.text);
r = await addAccount(ownerA, { bankName: 'CIMB', accountNumber: X1, accountHolder: 'x' }, 'housekeeper');
check('field staff cannot add an account (403)', r.status === 403, r.text);
r = await call(M.accounts, 'GET', `/api/owners/${ownerA}/accounts`, { params: { id: ownerA }, role: 'housekeeper' });
check('field staff cannot list accounts (403)', r.status === 403, r.text);
r = await call(M.accounts, 'GET', '/api/owners/nobody/accounts', { params: { id: 'nobody' } });
check('an unknown owner is 404', r.status === 404, r.text);

r = await call(M.accounts, 'GET', `/api/owners/${ownerA}/accounts`, { params: { id: ownerA } });
const listed = r.json?.data ?? [];
check('list shows both accounts with tail and inUse, never the number', r.status === 200 && listed.length === 2 && listed[0].last4 === X1.slice(-4) && listed[0].inUse === 0
  && listed[0].bankName === 'CIMB' && !r.text.includes(X1) && !r.text.includes(X2), r.text.replace(/\d{9,}/g, '#'));

r = await call(M.reveal, 'GET', `/api/owners/${ownerA}/accounts/${acc1}/reveal`, { params: { id: ownerA, accountId: acc1 } });
check('reveal returns the full number', r.status === 200 && r.json?.value === X1, String(r.status));
r = await call(M.reveal, 'GET', `/api/owners/${ownerA}/accounts/${acc1}/reveal`, { params: { id: ownerA, accountId: acc1 }, role: 'housekeeper' });
check('field staff cannot reveal (403)', r.status === 403, r.text);
r = await call(M.reveal, 'GET', `/api/owners/${ownerB}/accounts/${acc1}/reveal`, { params: { id: ownerB, accountId: acc1 } });
check('reveal under the wrong owner is 404', r.status === 404, r.text);
const audits = await all(env, "SELECT action, before_state, after_state FROM audit_log WHERE entity_id = ? AND action LIKE 'owner.%account%'", ownerA);
check('adds and the reveal are in the history, and no number is in the log',
  audits.some(a => a.action === 'owner.account_add') && audits.some(a => a.action === 'owner.reveal_account')
  && !audits.some(a => `${a.before_state}${a.after_state}`.includes(X1) || `${a.before_state}${a.after_state}`.includes(X2)), JSON.stringify(audits.map(a => a.action)));

r = await call(M.account, 'PATCH', `/api/owners/${ownerA}/accounts/${acc2}`, { params: { id: ownerA, accountId: acc2 }, body: { label: 'Tower 2', accountNumber: '••••0003' } });
check('edit the label; a masked number keeps the stored one', r.status === 200 && r.json?.changed === true, r.text);
r = await call(M.reveal, 'GET', '', { params: { id: ownerA, accountId: acc2 } });
check('the stored number is unchanged after the masked edit', r.json?.value === X2, String(r.status));
r = await call(M.account, 'PATCH', `/api/owners/${ownerA}/accounts/${acc2}`, { params: { id: ownerA, accountId: acc2 }, body: { accountNumber: '3000000004' } });
const edited = await one(env, 'SELECT account_last4 FROM owner_bank_accounts WHERE id = ?', acc2);
check('a new number changes the number and the last four', r.status === 200 && edited?.account_last4 === '0004', r.text);
await call(M.account, 'PATCH', `/api/owners/${ownerA}/accounts/${acc2}`, { params: { id: ownerA, accountId: acc2 }, body: { accountNumber: X2 } });
r = await call(M.account, 'PATCH', `/api/owners/${ownerB}/accounts/${acc2}`, { params: { id: ownerB, accountId: acc2 }, body: { label: 'x' } });
check('edit under the wrong owner is 404', r.status === 404, r.text);
r = await call(M.account, 'PATCH', `/api/owners/${ownerA}/accounts/${acc2}`, { params: { id: ownerA, accountId: acc2 }, body: { label: 'x' }, role: 'housekeeper' });
check('field staff cannot edit (403)', r.status === 403, r.text);

/* ---------- a unit's "pays to" ---------- */
r = await setPaysTo(uA1, accB);
check('a unit cannot pay to another owner\'s account (422)', r.status === 422 && r.json?.error?.code === 'VALIDATION', r.text);
r = await setPaysTo(uA1, 'no-such-account');
check('an unknown account is 422', r.status === 422, r.text);
r = await setPaysTo(uA1, acc1, 'housekeeper');
check('field staff cannot change where a unit is paid (403)', r.status === 403, r.text);
r = await setPaysTo(uA1, 7);
check('a number as the account id is 422', r.status === 422, r.text);
r = await setPaysTo(uA1, acc1);
check('point unit 1 at account 1', r.status === 200 && r.json?.changed === true, r.text);
r = await setPaysTo(uA2, acc2);
check('point unit 2 at account 2', r.status === 200, r.text);
r = await setPaysTo(uA1, acc1);
check('pointing at the same account again changes nothing', r.status === 200 && r.json?.changed === false, r.text);
const unitAudit = await all(env, "SELECT after_state FROM audit_log WHERE entity_id = ? AND action = 'unit.bank_account'", uA1);
check('the unit history says which account by bank and last four, not the number', unitAudit.length === 1 && unitAudit[0].after_state.includes(X1.slice(-4)) && !unitAudit[0].after_state.includes(X1), JSON.stringify(unitAudit));

r = await call(M.unitDetail, 'GET', `/api/units/detail?unitId=${uA1}`);
check('the unit record carries bankAccountId', r.status === 200 && r.json?.unit?.bankAccountId === acc1, r.text.slice(0, 200));
r = await call(M.unitDetail, 'GET', `/api/units/detail?unitId=${uA3}`);
check('bankAccountId is null on a unit with none', r.status === 200 && r.json?.unit?.bankAccountId === null, r.text.slice(0, 200));

r = await call(M.account, 'DELETE', `/api/owners/${ownerA}/accounts/${acc1}`, { params: { id: ownerA, accountId: acc1 } });
check('an account in use cannot be deleted (409)', r.status === 409 && r.json?.error?.code === 'CONFLICT' && /unit/.test(r.json.error.message), r.text);
r = await call(M.account, 'DELETE', `/api/owners/${ownerA}/accounts/${acc1}`, { params: { id: ownerA, accountId: acc1 }, role: 'housekeeper' });
check('field staff cannot delete (403)', r.status === 403, r.text);

/* ---------- the transfer file ---------- */
const stmA = await newStatement(ownerA, [[uA1, 30000], [uA2, 20000], [uA3, 10000]]);
let ex = await exportRows([stmA.payoutId]);
const byAmount = n => ex.rows.find(x => x.amount === n);
check('3 units on 3 accounts, two in one building, give 3 rows', ex.status === 200 && ex.rows.length === 3, ex.text.replace(/\d{9,}/g, '#'));
check('each row has its own account number', byAmount(30000)?.accountNumber === X1 && byAmount(20000)?.accountNumber === X2 && byAmount(10000)?.accountNumber === MAIN_A,
  JSON.stringify(ex.rows.map(x => [x.amount, x.accountNumber.slice(-4)])));
check('bank name follows the account', byAmount(30000)?.bankName === 'CIMB' && byAmount(20000)?.bankName === 'Hong Leong' && byAmount(10000)?.bankName === 'Maybank');
check('the unit with no pointer uses the owner\'s main account', byAmount(10000)?.accountNumber === MAIN_A);
check('none of them needs a hand check', ex.rows.every(x => x.checkByHand === false && x.note === undefined && x.payouts === 1));

// Two units in one building on the SAME extra account stay one row.
await setPaysTo(uA2, acc1);
ex = await exportRows([stmA.payoutId]);
check('two units in one building on one account are one row', ex.rows.length === 2 && ex.rows.find(x => x.amount === 50000)?.accountNumber === X1, JSON.stringify(ex.rows.map(x => [x.amount, x.units])));
await setPaysTo(uA2, acc2);

// A payout that cannot be split: the owner has units on another account, so the whole row is flagged.
const ownerC = await newOwner('c', '7000000007'), pc = await newBuilding('c');
const uC1 = await newUnit('C-01', pc, ownerC), uC2 = await newUnit('C-02', pc, ownerC);
const accC = (await addAccount(ownerC, { bankName: 'RHB', accountNumber: '7100000071', accountHolder: 'Holder C' })).json?.id;
await setPaysTo(uC1, accC);
const stmC = await newStatement(ownerC, [[uC1, 5000], [uC2, 4000]], { payout: 9500 });
ex = await exportRows([stmC.payoutId]);
check('a payout whose lines do not add up is one whole row under the main account, flagged', ex.rows.length === 1 && ex.rows[0].checkByHand === true && ex.rows[0].accountNumber === '7000000007'
  && ex.rows[0].amount === 9500 && typeof ex.rows[0].note === 'string' && ex.rows[0].note.length > 10, JSON.stringify(ex.rows.map(x => [x.amount, x.checkByHand, x.note])));
const ownerD = await newOwner('d', '7200000072'), pd = await newBuilding('d');
const uD1 = await newUnit('D-01', pd, ownerD);
const stmD = await newStatement(ownerD, [[uD1, 5000]], { payout: 6000 });
ex = await exportRows([stmD.payoutId]);
check('the same fallback for an owner with one account is not flagged', ex.rows.length === 1 && ex.rows[0].checkByHand === false && ex.rows[0].note === undefined, JSON.stringify(ex.rows));
// A repair bigger than the income of one account's units also falls back, and is flagged.
const ownerE = await newOwner('e', '7300000073'), pe = await newBuilding('e');
const uE1 = await newUnit('E-01', pe, ownerE), uE2 = await newUnit('E-02', pe, ownerE);
const accE = (await addAccount(ownerE, { bankName: 'AmBank', accountNumber: '7400000074', accountHolder: 'Holder E' })).json?.id;
await setPaysTo(uE2, accE);
const stmE = await newStatement(ownerE, [[uE1, 8000], [uE2, -2000]]);
ex = await exportRows([stmE.payoutId]);
check('an account that would go to zero or below falls back to one flagged row', ex.rows.length === 1 && ex.rows[0].checkByHand === true && ex.rows[0].amount === 6000, JSON.stringify(ex.rows.map(x => [x.amount, x.checkByHand])));
// A unit moved to another owner after its statement: the new owner's account must never receive the old owner's money.
const ownerJ = await newOwner('j', '7500000075'), ownerK = await newOwner('k', '7600000076'), pj = await newBuilding('j');
const uJ1 = await newUnit('J-01', pj, ownerJ);
const stmJ = await newStatement(ownerJ, [[uJ1, 4000]]);
const accK = (await addAccount(ownerK, { bankName: 'HLB', accountNumber: '7700000077', accountHolder: 'Holder K' })).json?.id;
await run(env, 'UPDATE units SET owner_id = ?, bank_account_id = ? WHERE id = ?', ownerK, accK, uJ1);
ex = await exportRows([stmJ.payoutId]);
check("an old statement of a unit that moved owner pays the statement owner's main, not the new owner's account",
  ex.rows.length === 1 && ex.rows[0].accountNumber === '7500000075' && ex.rows[0].amount === 4000, JSON.stringify(ex.rows.map(x => [x.accountNumber, x.amount])));
const tailsJ = await M.bank.differingAccountTails(env, stmJ.id);
check("and the statement shows no tail of the new owner's account", !tailsJ.some(t => t.last4 === '0077'), JSON.stringify(tailsJ));
r = await call(M.payoutExport, 'GET', `/api/payouts/export?ids=${stmA.payoutId}`, { role: 'housekeeper' });
check('field staff cannot export (403)', r.status === 403, r.text);

/* ---------- the bank test when a statement is sent ---------- */
const ownerF = await newOwner('f', null), pf = await newBuilding('f');
const uF1 = await newUnit('F-01', pf, ownerF), uF2 = await newUnit('F-02', pf, ownerF);
const accF = (await addAccount(ownerF, { bankName: 'OCBC', accountNumber: '8100000081', accountHolder: 'Holder F' })).json?.id;
await setPaysTo(uF1, accF);
const stmF1 = await newStatement(ownerF, [[uF1, 7000]], { withPayout: false });
r = await call(M.send, 'POST', '/api/statements/send', { body: { statementIds: [stmF1.id] } });
let pay = await one(env, 'SELECT state, bank_last4 FROM payouts WHERE statement_id = ?', stmF1.id);
check('no main account is fine when every line\'s unit has its own: pending, with that tail', r.status === 200 && pay?.state === 'pending' && pay.bank_last4 === '0081', JSON.stringify(pay) + r.text.slice(0, 200));
// A second owner with no main account, one unit on an extra and one on none: still "No bank details".
const ownerG = await newOwner('g', null), pg = await newBuilding('g');
const uG1 = await newUnit('G-01', pg, ownerG), uG2 = await newUnit('G-02', pg, ownerG);
const accG = (await addAccount(ownerG, { bankName: 'OCBC', accountNumber: '8200000082', accountHolder: 'Holder G' })).json?.id;
await setPaysTo(uG1, accG);
const stmG = await newStatement(ownerG, [[uG1, 7000], [uG2, 3000]], { withPayout: false });
await call(M.send, 'POST', '/api/statements/send', { body: { statementIds: [stmG.id] } });
pay = await one(env, 'SELECT state, failure_reason FROM payouts WHERE statement_id = ?', stmG.id);
check('no main account and one unit without its own: failed, "No bank details"', pay?.state === 'failed' && /No bank details/.test(pay.failure_reason), JSON.stringify(pay));
// Same test on POST /api/payouts (a sent statement that has no payout yet).
const ownerH = await newOwner('h', null), ph = await newBuilding('h');
const uH1 = await newUnit('H-01', ph, ownerH);
const accH = (await addAccount(ownerH, { bankName: 'OCBC', accountNumber: '8300000083', accountHolder: 'Holder H' })).json?.id;
await setPaysTo(uH1, accH);
const stmH = await newStatement(ownerH, [[uH1, 2000]], { state: 'sent', withPayout: false });
r = await call(M.payouts, 'POST', '/api/payouts', { body: { statementIds: [stmH.id] } });
pay = await one(env, 'SELECT state, bank_last4 FROM payouts WHERE statement_id = ?', stmH.id);
check('POST /api/payouts passes the same test', r.json?.created === 1 && pay?.bank_last4 === '0083', r.text);
const ownerI = await newOwner('i', null), pi = await newBuilding('i');
const uI1 = await newUnit('I-01', pi, ownerI);
const stmI = await newStatement(ownerI, [[uI1, 2000]], { state: 'sent', withPayout: false });
r = await call(M.payouts, 'POST', '/api/payouts', { body: { statementIds: [stmI.id] } });
check('an owner with no account at all is still skipped', r.json?.created === 0 && /No bank details/.test(r.json?.skipped?.[0]?.reason ?? ''), r.text);

/* ---------- statement PDF and owner portal ---------- */
await run(env, "UPDATE owner_statements SET state = 'paid' WHERE id = ?", stmA.id);
r = await call(M.pdf, 'GET', `/api/statements/pdf?id=${stmA.id}`);
check('the statement lists each account tail when units differ, no full number',
  r.status === 200 && r.text.includes('····0002') && r.text.includes('····0003') && r.text.includes('····0001') && !r.text.includes(X1) && !r.text.includes(MAIN_A), r.text.slice(0, 120));
await run(env, "UPDATE owner_statements SET state = 'paid' WHERE id = ?", stmF1.id);
r = await call(M.pdf, 'GET', `/api/statements/pdf?id=${stmF1.id}`);
check('no main account and one extra: the statement names that account', r.status === 200 && r.text.includes('Transferred to OCBC ····0081') && !r.text.includes('8100000081'), r.text.slice(0, 120));
r = await call(M.summary, 'GET', `/api/owner/summary?ownerId=${ownerF}&period=2031-03`);
check('no main account and one extra: the portal lists that one account', r.status === 200 && r.json?.payout?.accounts?.length === 1 && r.json.payout.accounts[0].last4 === '0081', r.text.slice(0, 300));
await run(env, "UPDATE owner_statements SET state = 'paid' WHERE id = ?", stmD.id);
r = await call(M.pdf, 'GET', `/api/statements/pdf?id=${stmD.id}`);
check('every line on the main account: the statement reads as before', r.status === 200 && r.text.includes('Transferred to Maybank ····0072'), r.text.slice(0, 120));
r = await call(M.summary, 'GET', `/api/owner/summary?ownerId=${ownerA}&period=2031-03`);
check('portal summary lists the account tails for owner A', r.status === 200 && r.json?.payout?.accounts?.length === 3 && !r.text.includes(X1), r.text.slice(0, 300));
r = await call(M.summary, 'GET', `/api/owner/summary?ownerId=${ownerD}&period=2031-03`);
check('portal summary has none for one account', r.status === 200 && r.json?.payout?.accounts?.length === 0, r.text.slice(0, 300));

/* ---------- owner change clears the pointer ---------- */
r = await call(M.unitPatch, 'PATCH', `/api/units/${uA1}`, { params: { id: uA1 }, body: { ownerId: ownerB } });
const moved = await one(env, 'SELECT owner_id, bank_account_id FROM units WHERE id = ?', uA1);
check('moving a unit to another owner clears its account', r.status === 200 && moved?.owner_id === ownerB && moved.bank_account_id === null, r.text + JSON.stringify(moved));
await call(M.unitPatch, 'PATCH', `/api/units/${uA1}`, { params: { id: uA1 }, body: { ownerId: ownerA } });

/* ---------- delete once nothing points at it ---------- */
for (const u of [uA2]) await setPaysTo(u, null);
r = await call(M.account, 'DELETE', `/api/owners/${ownerA}/accounts/${acc2}`, { params: { id: ownerA, accountId: acc2 } });
check('an account nobody uses can be deleted', r.status === 200 && r.json?.ok === true, r.text);
check('and it is gone', !(await one(env, 'SELECT 1 AS x FROM owner_bank_accounts WHERE id = ?', acc2)));

/* ---------- import: main account and extras ---------- */
const Db = { all: (sql, ...a) => all(env, sql, ...a), run: (sql, ...a) => run(env, sql, ...a) };
const wbUnit = (id, ownerName, account) => ({
  row: 1, workbookId: id, listingName: null, address: null, ownerName, ic: null, bankName: 'Maybank', bankAccount: account, bankHolder: ownerName,
  pkg: null, packageD: false, term: null, split: null, splitValue: null, miscCharges: false, contract: null, utilityAccounts: [], debt: null, poolMonths: [],
});
const unitOf = async wid => one(env, 'SELECT u.id, u.owner_id, u.bank_account_id, a.account_number AS acct, a.label FROM units u LEFT JOIN owner_bank_accounts a ON a.id = u.bank_account_id WHERE u.id = ?', `wb-unit-${M.imp.slug(wid)}`);
const W = `ZZBANK${tag.toUpperCase()}`;
const wbOwner = `Import Owner ${tag}`;
let res = await M.impDb.importWorkbookUnits(Db, [wbUnit(`${W}-ODD-01`, wbOwner, '9000000002'), wbUnit(`${W}-ONE-01`, wbOwner, '9000000001'), wbUnit(`${W}-ONE-02`, wbOwner, '9000000001')], now);
const wbId = await M.imp.workbookOwnerId({ ic: null, ownerName: wbOwner });
const wbRow = await one(env, 'SELECT bank_account_number FROM owners WHERE id = ?', wbId);
check('import: the account most units use is the owner\'s main (not the first row\'s)', wbRow?.bank_account_number === '9000000001');
const odd = await unitOf(`${W}-ODD-01`), one1 = await unitOf(`${W}-ONE-01`);
check('import: the odd unit points at an extra account on that owner', odd?.bank_account_id?.startsWith('wb-obank-') && odd.acct === '9000000002' && odd.owner_id === wbId && !!odd.label, JSON.stringify({ ...odd, acct: undefined }));
check('import: units on the main account point at nothing', one1?.bank_account_id === null);
check('import: a note says how many units got their own account', res.notes.some(n => /^1 units got their own bank account/.test(n)), JSON.stringify(res.notes));
res = await M.impDb.importWorkbookUnits(Db, [wbUnit(`${W}-ODD-01`, wbOwner, '9000000002'), wbUnit(`${W}-ONE-01`, wbOwner, '9000000001'), wbUnit(`${W}-ONE-02`, wbOwner, '9000000001')], now);
const accounts = await all(env, 'SELECT id FROM owner_bank_accounts WHERE owner_id = ?', wbId);
check('import: a second run adds no account and changes no pointer', accounts.length === 1 && (await unitOf(`${W}-ODD-01`)).bank_account_id === odd.bank_account_id && res.notes.some(n => /^0 units got/.test(n)), JSON.stringify(res.notes));
// A pointer a person set is never overwritten.
const mine = (await addAccount(wbId, { bankName: 'CIMB', accountNumber: '9500000009', accountHolder: 'Mine' })).json?.id;
await setPaysTo(odd.id, mine);
await M.impDb.importWorkbookUnits(Db, [wbUnit(`${W}-ODD-01`, wbOwner, '9000000002'), wbUnit(`${W}-ONE-01`, wbOwner, '9000000001'), wbUnit(`${W}-ONE-02`, wbOwner, '9000000001')], now);
check('import: a pointer set by a person is never overwritten', (await unitOf(`${W}-ODD-01`)).bank_account_id === mine);
// Choosing "the owner's main account" by hand is a choice too: the next import must not point the unit away again.
await setPaysTo(odd.id, null);
await M.impDb.importWorkbookUnits(Db, [wbUnit(`${W}-ODD-01`, wbOwner, '9000000002'), wbUnit(`${W}-ONE-01`, wbOwner, '9000000001'), wbUnit(`${W}-ONE-02`, wbOwner, '9000000001')], now);
check('import: a person choosing the main account is kept', (await unitOf(`${W}-ODD-01`)).bank_account_id === null);

// An owner typed in by hand keeps the stored main account; units on any other number get an account of their own.
const kept = await newOwner('kept', '8000000001');
const keptName = (await one(env, 'SELECT display_name FROM owners WHERE id = ?', kept)).display_name;
await M.impDb.importWorkbookUnits(Db, [wbUnit(`${W}-KEEP-01`, keptName, '7000000001'), wbUnit(`${W}-KEEP-02`, keptName, '7000000001')], now);
const keptRow = await one(env, 'SELECT bank_account_number FROM owners WHERE id = ?', kept);
const k1 = await unitOf(`${W}-KEEP-01`), k2 = await unitOf(`${W}-KEEP-02`);
check('import: a hand-made owner\'s main account is not replaced', keptRow?.bank_account_number === '8000000001');
check('import: both units share one extra account on that owner', k1?.acct === '7000000001' && k1.bank_account_id === k2?.bank_account_id && k1.owner_id === kept, JSON.stringify([k1?.owner_id === kept, k1?.bank_account_id === k2?.bank_account_id]));

done();
