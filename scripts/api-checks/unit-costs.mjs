// A unit's costs, end to end (feat/unit-costs): every cost reaches a unit by its date, and the unit's Costs panel,
// its table, the owner page and the owner statement draft all read the same rows by the same month rule.
//   1. a cleaning job is finished -> one cleaning cost on the unit, dated today
//   2. a bill is added with a bill date in an earlier month -> it lands in that month, not this one
//   3. GET /api/expenses/breakdown (the unit's cards and table, and the owner page) shows each in its own month,
//      the cards total the table, and the owner statement draft of each month carries the same expense at the same amount
//   4. with DB_URL set: a clean imported as done without a cost is listed as uncharged, and
//      POST /api/expenses/clean-charges charges it dated the day it was finished
//   5. a bill without a date is refused; operations staff cannot charge cleans
//
// Run against a throwaway database (scripts/ci-api-db.mjs, or any local copy of it) and a local server:
//   npm run dev  (SESSION_SECRET=smoke-test-secret-not-real-0123456789), then
//   node scripts/api-checks/unit-costs.mjs                          (API only)
//   DB_URL=postgres://postgres@127.0.0.1:5432/ci node scripts/api-checks/unit-costs.mjs   (also step 4)
// STATEMENTS=lib (with DB_URL) builds the statement drafts with the generator's own code (functions/_lib/ownerStatement.ts
// loadInputs + computeMonth, what POST /api/statements/generate runs) instead of over HTTP: a PGlite stand-in serves one
// connection at a time, and generate's transaction needs a second one, so it waits forever there. CI uses HTTP.
// It adds a cleaning job, a bill and draft statements; it does not clean up, so use a database made for checks.
import postgres from 'postgres';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { call, check, done, cookieFor } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const DB_URL = process.env.DB_URL ?? '';
const VIA_LIB = process.env.STATEMENTS === 'lib' && !!DB_URL;
const numbered = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
// One connection per query, one query at a time: a PGlite stand-in serves one connection at a time.
let queue = Promise.resolve();
const db = (text, ...values) => {
  const next = queue.then(async () => {
    const c = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {}, connection: { search_path: 'pos' },
      types: { number: { to: 20, from: [20, 1700], serialize: x => String(x), parse: x => Number(x) } } });
    try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
  });
  queue = next.catch(() => {});
  return next;
};

/** The owner's statement draft for a month: expense lines on the unit, as { expenseId, amount }. */
let S = null;
async function statementLines(month, ownerId, unitId) {
  if (!VIA_LIB) {
    const r = await call('POST', '/api/statements/generate', { period: month, ownerIds: [ownerId] });
    check(`${month}: owner statement draft generated`, r.status === 202, r.text);
    const sid = r.json?.statements?.find(x => x.ownerId === ownerId)?.id;
    const st = sid ? (await call('GET', `/api/statements/${sid}`)).json?.data : null;
    return (st?.lines ?? []).filter(l => l.type === 'expense' && l.unitId === unitId).map(l => ({ expenseId: l.expenseId, amount: Number(l.amount) }));
  }
  if (!S) {
    const { build } = await import('esbuild');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const out = await build({ stdin: { contents: `export * from './functions/_lib/ownerStatement.ts'; export { monthEndExclusive } from './functions/_lib/revenue.ts';`, resolveDir: root, loader: 'ts' },
      bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
    const tmp = mkdtempSync(join(tmpdir(), 'unit-costs-'));
    writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
    S = await import(pathToFileURL(join(tmp, 'm.mjs')).href);
  }
  const q = (sql, ...args) => db(numbered(sql), ...args);
  const [settings, inputs] = await Promise.all([S.statementSettings(q), S.loadInputs(q, `${month}-01`, S.monthEndExclusive(month), { ownerIds: [ownerId] })]);
  const months = S.computeMonth(month, inputs, settings, 'open').filter(S.hasActivity);
  check(`${month}: owner statement draft built (generator code)`, months.some(m => m.unitId === unitId));
  return months.filter(m => m.unitId === unitId).flatMap(m => m.lines).filter(l => l.type === 'expense').map(l => ({ expenseId: l.expenseId, amount: Number(l.amount) }));
}
const myt = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const shiftMonth = (ym, by) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return d.toISOString().slice(0, 7); };
const today = myt(), thisMonth = today.slice(0, 7), lastMonth = shiftMonth(thisMonth, -1);
const sum = xs => xs.reduce((n, x) => n + x, 0);
const breakdown = async (month, q) => (await call('GET', `/api/expenses/breakdown?month=${month}&${q}`)).json;

/** The cards are a summary of the table: each owner-paid row adds to exactly one card and to "deducted". */
function reconciles(b, unitId) {
  const u = b.units.find(x => x.unitId === unitId);
  const items = b.items.filter(i => i.unitId === unitId);
  const owner = items.filter(i => i.chargeTo === 'owner'), others = items.filter(i => i.chargeTo !== 'owner');
  const by = g => sum(owner.filter(i => i.group === g).map(i => i.amount));
  const t = u.totals;
  return t.deducted === sum(owner.map(i => i.amount)) && t.notCharged === sum(others.map(i => i.amount))
    && t.cleaning === by('cleaning') && t.maintenance === by('maintenance') && t.utilities === by('utilities') && t.other === by('other');
}

/* ---------- a unit whose statement deducts its costs, with no final statement this month or last ---------- */
const units = (await call('GET', '/api/units?pageSize=200')).json?.data ?? [];
check('units listed', units.length > 0);
let unit = null, ownerId = null;
for (const u of units) {
  const b = await breakdown(thisMonth, `unitId=${encodeURIComponent(u.id)}`);
  if (!b?.units?.[0]?.deductsFromOwner) continue;
  // A probe bill of RM 0.00 tells whether either month is already final for this owner.
  const probe = await call('POST', '/api/expenses', { unitId: u.id, category: 'other', amount: 0, incurredOn: `${lastMonth}-02`, description: 'probe' });
  if (probe.status !== 201) continue;
  unit = u; break;
}
check('found a unit that deducts costs and is open last month', !!unit);
if (!unit) done();
ownerId = unit.ownerId;
const q = `unitId=${encodeURIComponent(unit.id)}`;
const before = { now: await breakdown(thisMonth, q), last: await breakdown(lastMonth, q) };

/* ---------- 1. finish a clean ---------- */
let r = await call('POST', '/api/housekeeping/tasks', { unitId: unit.id, kind: 'turnover', title: 'Unit costs check clean' });
check('cleaning job created', r.status === 201, r.text);
const taskId = r.json?.id;
const fd = new FormData();
fd.append('file', new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'proof.png');
const up = await fetch(`${BASE}/api/tasks/${taskId}/photos`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: fd });
check('proof photo added (or storage not set up)', up.status === 201 || up.status === 501, String(up.status));
r = await call('POST', `/api/tasks/${taskId}/complete`, { photoIds: [] });
check('clean finished and charged', r.status === 200 && r.json?.cost?.created === true && r.json.cost.amount > 0, r.text);
const cleanAmount = r.json?.cost?.amount ?? 0;
r = await call('POST', `/api/tasks/${taskId}/complete`, { photoIds: [] });
const nowB = await breakdown(thisMonth, q);
const clean = nowB.items.find(i => i.taskId === taskId);
check('the clean is one cost on the unit, dated today, from a cleaning job', !!clean && clean.incurredOn === today && clean.source === 'cleaning_job' && clean.kind === 'cleaning' && clean.amount === cleanAmount,
  JSON.stringify(clean));
check('finishing it twice does not charge twice', nowB.items.filter(i => i.taskId === taskId).length === 1);
check('Cleaning fees card went up by exactly the clean', nowB.units[0].totals.cleaning === before.now.units[0].totals.cleaning + cleanAmount,
  `${before.now.units[0].totals.cleaning} -> ${nowB.units[0].totals.cleaning}`);

/* ---------- 2. a bill dated last month ---------- */
const billDay = `${lastMonth}-17`, billAmount = 12345;
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'water', amount: billAmount, incurredOn: billDay, chargeTo: 'owner', reference: 'CHK-WATER', description: 'Water check bill' });
check('bill with a past bill date recorded', r.status === 201, r.text);
const billId = r.json?.id;
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'water', amount: 100, chargeTo: 'owner' });
check('a bill without a date is refused', r.status === 422, r.text);

const lastB = await breakdown(lastMonth, q);
const nowB2 = await breakdown(thisMonth, q);
const bill = lastB.items.find(i => i.id === billId);
check('the bill is in its bill-date month, as a bill, with its date', !!bill && bill.incurredOn === billDay && bill.source === 'bill' && bill.kind === 'water' && bill.amount === billAmount, JSON.stringify(bill));
check('the bill is not in this month', !nowB2.items.some(i => i.id === billId));
check('Utilities card of that month went up by exactly the bill', lastB.units[0].totals.utilities === before.last.units[0].totals.utilities + billAmount);

/* ---------- 3. cards total the table; the owner page and the statement read the same rows ---------- */
check(`${thisMonth}: the cards total the table`, reconciles(nowB2, unit.id));
check(`${lastMonth}: the cards total the table`, reconciles(lastB, unit.id));
if (ownerId) {
  const ownerNow = await breakdown(thisMonth, `ownerId=${encodeURIComponent(ownerId)}`);
  const ownerLast = await breakdown(lastMonth, `ownerId=${encodeURIComponent(ownerId)}`);
  check('owner page (Expenses by unit) lists the clean this month', ownerNow.items.some(i => i.taskId === taskId));
  check('owner page lists the bill last month only', ownerLast.items.some(i => i.id === billId) && !ownerNow.items.some(i => i.id === billId));
  const ownUnitNow = ownerNow.units.find(x => x.unitId === unit.id), ownUnitLast = ownerLast.units.find(x => x.unitId === unit.id);
  check('owner page unit totals equal the unit panel totals', JSON.stringify(ownUnitNow.totals) === JSON.stringify(nowB2.units[0].totals) && JSON.stringify(ownUnitLast.totals) === JSON.stringify(lastB.units[0].totals));

  for (const [month, b, mustHave, mustNot] of [[thisMonth, nowB2, clean?.id, billId], [lastMonth, lastB, billId, clean?.id]]) {
    const lines = await statementLines(month, ownerId, unit.id);
    const line = lines.find(l => l.expenseId === mustHave);
    const expected = b.items.find(i => i.id === mustHave)?.amount;
    check(`${month}: the statement draft carries the cost at the same amount`, !!line && -Number(line.amount) === expected, JSON.stringify({ line, expected }));
    check(`${month}: the statement draft does not carry the other month's cost`, !lines.some(l => l.expenseId === mustNot));
    const ownerPaid = b.items.filter(i => i.unitId === unit.id && i.chargeTo === 'owner');
    check(`${month}: statement expense lines for the unit = the panel's owner-paid rows`,
      sum(lines.map(l => -Number(l.amount))) === sum(ownerPaid.map(i => i.amount)) && sum(ownerPaid.map(i => i.amount)) === b.units[0].totals.deducted,
      `statement ${sum(lines.map(l => -Number(l.amount)))} in ${lines.length} lines, panel ${b.units[0].totals.deducted} in ${ownerPaid.length} rows`);
  }
} else check('owner id of the unit found', false);

/* ---------- 4. a clean imported as done without a cost ---------- */
if (DB_URL) {
  const doneDay = `${lastMonth}-09`, id = `wb-clean-check-${Date.now()}`;
  await db(`INSERT INTO tasks (id, unit_id, kind, state, title, due_at, completed_at, requires_photo, created_at, updated_at)
    VALUES ($1, $2, 'turnover', 'resolved', 'Imported clean, no price', $3, $3, 0, now(), now())`, id, unit.id, `${doneDay}T12:00:00+08:00`);
  let b = await breakdown(lastMonth, q);
  check('an imported finished clean with no cost is listed as uncharged', b.unchargedCleans.some(c => c.taskId === id && c.doneOn === doneDay), JSON.stringify(b.unchargedCleans));
  r = await call('POST', '/api/expenses/clean-charges', { unitId: unit.id, month: lastMonth }, 'operations_staff');
  check('operations staff cannot charge cleans', r.status === 403, String(r.status));
  r = await call('POST', '/api/expenses/clean-charges', { unitId: unit.id, month: lastMonth });
  check('clean-charges charges it', (r.status === 201 || r.status === 200) && r.json.charged.some(c => c.taskId === id && c.day === doneDay), r.text);
  b = await breakdown(lastMonth, q);
  const charged = b.items.find(i => i.taskId === id);
  check('it is now a cleaning cost dated the day it was finished', !!charged && charged.incurredOn === doneDay && charged.source === 'cleaning_job' && charged.amount > 0, JSON.stringify(charged));
  check('and no longer uncharged; the cards still total the table', !b.unchargedCleans.some(c => c.taskId === id) && reconciles(b, unit.id));
  r = await call('POST', '/api/expenses/clean-charges', { unitId: unit.id, month: lastMonth });
  check('charging again adds nothing', r.status === 200 && !r.json.charged.some(c => c.taskId === id), r.text);
  const audits = await db(`SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'expense.clean_catch_up'`, unit.id);
  check('the catch-up is audited', audits.length >= 1);
}
done();
