// The Dashboard's owner figures (functions/_lib/ownerEstimate.ts ownerMonths) against the way they were worked out
// before Oct 2026: withYearToDate once per month, which loaded and worked out a yearly-guarantee unit's earlier months
// again for every month that closes its contract year. Both run on the same data: a throwaway database
// (scripts/dev-pglite.mjs: every migration and the demo data) plus three yearly-guarantee units added here, one of
// them on an earlier contract kept in the unit's history, with stays and owner costs across a year boundary. Every
// unit's month must come out identical, to the sen, for 1, 3 and 12 months. It also counts the database queries.
//
// Run: node scripts/api-checks/owner-months.mjs           (PORT defaults to 55478)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT ?? 55478);

const db = spawn(process.execPath, ['scripts/dev-pglite.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
const url = await new Promise((resolve, reject) => {
  let seen = '';
  db.stdout.on('data', d => { seen += d; const m = /ready: (\S+)/.exec(seen); if (m) resolve(m[1]); });
  db.on('exit', code => reject(new Error(`dev-pglite exited ${code}: ${seen}`)));
});
db.removeAllListeners('exit');

const out = await build({
  stdin: { contents: `export * from './functions/_lib/ownerEstimate.ts'; export * from './functions/_lib/ownerStatement.ts'; export { monthEndExclusive } from './functions/_lib/revenue.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'owner-months-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

// As functions/_lib/db.ts reads the database: `?` numbered, int8 and numeric as numbers. Every query is counted.
const sql = postgres(url, { max: 1, prepare: false, fetch_types: false,
  types: { number: { to: 20, from: [20, 1700], serialize: x => String(x), parse: x => Number(x) } } });
let queries = 0;
const q = (text, ...args) => { queries++; let i = 0; return sql.unsafe(text.replace(/\?/g, () => `$${++i}`), args); };

let fails = 0;
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${more ? ` :: ${more}` : ''}`); };

/* ---------- Data: three yearly-guarantee units on the demo owners ---------- */
const U1 = '55555555-5555-4555-8555-000000000001', U2 = '55555555-5555-4555-8555-000000000002', U3 = '55555555-5555-4555-8555-000000000003';
const units = await sql`select id, owner_id from units order by id`;
const ownerOf = Object.fromEntries(units.map(u => [u.id, u.owner_id]));
const now = '2026-10-01T00:00:00Z';
const contract = (id, unit, over) => sql`insert into owner_contracts ${sql({
  id, unit_id: unit, owner_id: ownerOf[unit], management_fee_pct: 25, model: 'management', revenue_model: 'management_yearly_guarantee',
  starts_on: null, ends_on: null, minimum_guarantee: 0, minimum_guarantee_annual: null, misc_charges: 0, created_at: now, ...over,
})}`;
const addMonths = (m, n) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };

// Unit 1: the contract year Nov 2025 to Oct 2026 closes in Oct 2026, the last month of every window checked.
await contract('chk-y1', U1, { starts_on: '2025-11-01', minimum_guarantee_annual: 3600000, misc_charges: 1 });
await sql`update units set contract_id = 'chk-y1' where id = ${U1}`;

// Stays (a few nights a month, odd amounts so the night split rounds) and owner costs, May 2025 to Oct 2026, kept
// clear of the demo's own Aug and Sep 2026 stays; plus stays across month ends, the window starts among them.
let n = 0;
const stay = (unit, ci, co, amount) => sql`insert into reservations ${sql({
  id: `chk-r-${++n}`, unit_id: unit, channel: n % 2 ? 'airbnb' : 'booking_com', state: 'checked_out', check_in: ci, check_out: co,
  collected_revenue: amount, created_at: now, updated_at: now,
})}`;
const cost = (unit, day, category, amount, description = category) => sql`insert into expenses ${sql({
  id: `chk-e-${++n}`, unit_id: unit, category, description, amount, incurred_on: day, charge_to: 'owner', created_at: now,
})}`;
async function trade(unit, seed) {
  for (let m = '2025-05'; m <= '2026-10'; m = addMonths(m, 1)) {
    if (unit === U1 && (m === '2026-08' || m === '2026-09')) continue;
    const k = Number(m.slice(5, 7)) + seed;
    await stay(unit, `${m}-0${1 + (k % 3)}`, `${m}-${String(5 + (k % 5)).padStart(2, '0')}`, 54321 + k * 7919);
    await cost(unit, `${m}-10`, 'cleaning', 8000);
    await cost(unit, `${m}-15`, 'electricity', 4567 + k * 31);
  }
}
await trade(U1, 0);
await stay(U1, '2026-07-27', '2026-08-01', 123457);
await stay(U1, '2026-09-28', '2026-10-02', 98765);

/* ---------- Query counts, 12 months, before and after ---------- */
const months = (last, count) => Array.from({ length: count }, (_, i) => addMonths(last, i - count + 1));

// ownerMonths as it was before Oct 2026 (ownerEstimate.ts), on the engine's still-exported functions.
async function oldOwnerMonths(list) {
  const sorted = [...list].sort();
  const [settings, inputs] = await Promise.all([M.statementSettings(q), M.loadInputs(q, `${sorted[0]}-01`, M.monthEndExclusive(sorted[sorted.length - 1]))]);
  const inputsByMonth = await Promise.all(sorted.map(month => M.withYearToDate(q, inputs, month, settings)));
  return new Map(sorted.map((month, i) => [month, M.computeMonth(month, inputsByMonth[i], settings, 'dated')]));
}
// The new path, with every unit's month (ownerMonthsFor keeps only the totals).
async function newRows(list) {
  const sorted = [...list].sort();
  const [settings, inputs] = await Promise.all([M.statementSettings(q), M.loadInputs(q, `${sorted[0]}-01`, M.monthEndExclusive(sorted[sorted.length - 1]))]);
  return M.computeMonthsWithYearToDate(q, inputs, sorted, settings);
}
const counted = async fn => { queries = 0; await fn(); return queries; };
const trend = months('2026-10', 12);
const counts = [];
counts.push([1, await counted(() => oldOwnerMonths(trend)), await counted(() => M.ownerMonthsFor(q, trend))]);

// Unit 2: a contract from 15 Sep 2024, so its year Sep 2025 to Aug 2026 closes inside the window and starts before it.
await contract('chk-y2', U2, { starts_on: '2024-09-15', minimum_guarantee_annual: 2400000, management_fee_pct: 20 });
await sql`update units set contract_id = 'chk-y2' where id = ${U2}`;
await trade(U2, 4);
await stay(U2, '2025-10-28', '2025-11-03', 87654);
// A long stay paid in monthly instalments (booking_payments, the owner workbook's payout lines).
await stay(U2, '2026-01-10', '2026-03-10', 0);
for (const [i, [a, b, amt]] of [['2026-01-10', '2026-02-10', 310001], ['2026-02-10', '2026-03-10', 280003]].entries()) {
  await sql`insert into booking_payments ${sql({ id: `chk-bp-${i}`, reservation_id: `chk-r-${n}`, amount: amt, status: 'received', kind: 'ota_payout', source: 'owner_workbook', note: `Payout line for ${a} to ${b}`, created_at: now })}`;
}
// Unit 3: an earlier yearly contract, Jun 2025 to May 2026 (ended early, so the guarantee is prorated), kept in the
// unit's history; the current contract is a plain management share from Jun 2026.
await contract('chk-y3-old', U3, { starts_on: '2025-06-01', ends_on: '2026-05-31', minimum_guarantee_annual: 3000000, created_at: '2025-05-01T00:00:00Z' });
// A short contract inside that year (Aug and Sep 2025): those months are under it, so the true-up leaves them out.
await contract('chk-y3-mid', U3, { starts_on: '2025-08-01', ends_on: '2025-09-30', revenue_model: 'management', management_fee_pct: 10, created_at: '2025-07-01T00:00:00Z' });
await contract('chk-y3', U3, { starts_on: '2026-06-01', revenue_model: 'management', management_fee_pct: 30 });
await sql`update units set contract_id = 'chk-y3' where id = ${U3}`;
await trade(U3, 8);
counts.push([3, await counted(() => oldOwnerMonths(trend)), await counted(() => M.ownerMonthsFor(q, trend))]);

console.log('Database queries for the Dashboard trend, 12 months (Nov 2025 to Oct 2026):');
for (const [k, before, after] of counts) console.log(`  ${k} yearly-guarantee ${k === 1 ? 'unit' : 'units'}: before ${before}, after ${after}`);
// After: the usual 2 (settings and one loadInputs), plus one more loadInputs when a contract year starts before the window.
check('fewer queries after, never more than 13', counts.every(([, b, a]) => a < b && a <= 13), JSON.stringify(counts));

/* ---------- Same figures, to the sen ---------- */
const totals = rows => rows.reduce((t, m) => ({ income: t.income + m.gross, ownerCosts: t.ownerCosts + m.deductions, operatorShare: t.operatorShare + m.operatorShare, netPayout: t.netPayout + m.netPayout }),
  { income: 0, ownerCosts: 0, operatorShare: 0, netPayout: 0 });
for (const count of [1, 3, 12]) {
  const list = months('2026-10', count);
  const [before, rows, after] = [await oldOwnerMonths(list), await newRows(list), await M.ownerMonthsFor(q, list)];
  const sameTotals = list.every(m => JSON.stringify(totals(before.get(m))) === JSON.stringify(after.get(m)));
  check(`${count} ${count === 1 ? 'month' : 'months'}: ownerMonths totals identical`, sameTotals,
    sameTotals ? '' : list.map(m => `${m} before ${JSON.stringify(totals(before.get(m)))} after ${JSON.stringify(after.get(m))}`).join('; '));
  const diff = list.flatMap(m => before.get(m).map((r, i) => [m, r, rows.get(m)[i]]).filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)));
  check(`${count} ${count === 1 ? 'month' : 'months'}: every unit's month identical`, !diff.length, diff.slice(0, 2).map(([m, a]) => `${m} ${a.unitId}`).join(', '));
  const trueUps = [...rows.values()].flat().filter(r => r.yearly?.trueUp);
  check(`${count} ${count === 1 ? 'month' : 'months'}: the yearly true-up is worked out (${trueUps.map(r => `${r.month} top-up RM ${(r.topUp / 100).toFixed(2)}`).join(', ')})`,
    trueUps.length > 0 && trueUps.every(r => r.yearly.yearShares !== null && r.yearly.sharesBefore > 0));
}
const twelve = await newRows(trend);
check('12 months: unit 2 trues up in Aug 2026 and unit 3 (earlier contract) in May 2026',
  twelve.get('2026-08').find(r => r.unitId === U2)?.yearly?.trueUp === true && twelve.get('2026-05').find(r => r.unitId === U3)?.yearly?.trueUp === true);

/* ---------- loadInputs in one statement, against the six it used to send (Oct 2026) ---------- */
// Owner adjustments too (the demo has none): one with no unit, one held (left out), one before the window.
for (const [i, [unit, kind, amount, on, state]] of [[U1, 'credit', 12345, '2026-03-15', 'open'], [null, 'charge', 6789, '2026-09-02', 'open'],
  [U2, 'credit', 5000, '2026-08-20', 'held'], [U3, 'opening_debt', 40000, '2025-10-01', 'settled']].entries()) {
  await sql`insert into owner_adjustments ${sql({ id: `chk-a-${i}`, owner_id: ownerOf[unit ?? U1], unit_id: unit, kind, amount, description: `Check ${i}`,
    occurred_on: on, state, created_at: now, updated_at: now })}`;
}
// loadInputs as it was before: the units first, then four lists by their ids, then the payments by the stays' ids.
async function sixQueries(from, toExclusive, scope = {}) {
  const unitWhere = scope.unitId ? 'WHERE u.id = ?' : scope.unitIds ? 'WHERE u.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))'
    : scope.ownerIds ? 'WHERE u.owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : '';
  const unitArg = scope.unitId ? [scope.unitId] : scope.unitIds ? [JSON.stringify(scope.unitIds)] : scope.ownerIds ? [JSON.stringify(scope.ownerIds)] : [];
  const units = await q(`${M.UNIT_SQL} ${unitWhere} ORDER BY p.name, u.unit_number`, ...unitArg);
  const ids = JSON.stringify(units.map(u => u.id));
  const list = '(SELECT jsonb_array_elements_text(?::text::jsonb))';
  const stays = await q(`SELECT r.id, r.unit_id, r.check_in, r.check_out, r.collected_revenue, r.channel, r.external_ref, g.full_name AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id WHERE r.state IN ('confirmed','checked_in','checked_out')
    AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.check_in < ? AND r.check_out > ? AND r.unit_id IN ${list}`, toExclusive, from, ids);
  const costs = await q(`SELECT e.id, e.unit_id, e.category, e.description, e.amount, e.incurred_on, e.deduct_month, e.rolled, e.reference, t.kind AS task_kind
    FROM expenses e LEFT JOIN tasks t ON t.id = e.task_id WHERE e.charge_to = 'owner' AND NOT e.record_only AND e.deduct_month >= substr(?, 1, 7) AND e.deduct_month < substr(?, 1, 7) AND e.unit_id IN ${list}`, from, toExclusive, ids);
  const adjustments = await q(`SELECT a.id, a.owner_id, a.unit_id, a.kind, a.amount, a.description, a.occurred_on, a.reference, a.state, a.statement_id
    FROM owner_adjustments a WHERE a.state <> 'held' AND a.occurred_on < ? AND a.owner_id IN (SELECT DISTINCT owner_id FROM units WHERE id IN ${list})
    ORDER BY a.occurred_on, a.id`, toExclusive, ids);
  const history = await q(`SELECT c.id, c.unit_id, c.revenue_model, c.model, c.management_fee_pct, c.grr_amount, c.starts_on, c.ends_on, c.minimum_guarantee,
    c.guarantee_starts_on, c.guarantee_ends_on, c.misc_charges, c.tenant_name, c.agent_fee_pct, c.minimum_guarantee_annual
    FROM owner_contracts c WHERE c.unit_id IN ${list} ORDER BY c.starts_on DESC, c.created_at DESC`, ids);
  const pieces = stays.length ? await q(`SELECT reservation_id, amount, status, kind, source, note FROM booking_payments WHERE reservation_id IN ${list}`, JSON.stringify(stays.map(s => s.id))) : [];
  const of = (rows, key) => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) ?? []), { ...r }]), new Map());
  const historyOf = of(history, 'unit_id'), piecesOf = of(pieces, 'reservation_id');
  return {
    units: units.map(u => (historyOf.get(u.id) ? { ...u, history: historyOf.get(u.id) } : { ...u })),
    // The new statement lists stays by check-in, then id (the old one in whatever order the database read them).
    stays: stays.map(s => {
      const row = { ...s, check_in: s.check_in.slice(0, 10), check_out: s.check_out.slice(0, 10), collected_revenue: Number(s.collected_revenue) };
      const parts = M.stayParts(row, piecesOf.get(s.id) ?? []);
      return parts ? { ...row, parts } : row;
    }).sort((a, b) => a.check_in.localeCompare(b.check_in) || (a.id < b.id ? -1 : 1)),
    costs: costs.map(c => ({ ...c, incurred_on: c.incurred_on.slice(0, 10), amount: Number(c.amount) })),
    adjustments: adjustments.map(a => ({ ...a, amount: Number(a.amount) })),
  };
}
// Costs come in no set order, before or after.
const costsById = i => ({ ...i, costs: [...i.costs].sort((a, b) => (a.id < b.id ? -1 : 1)) });
for (const [label, scope] of [['every unit', {}], ['one owner', { ownerIds: [ownerOf[U2]] }], ['two units', { unitIds: [U1, U3] }], ['one unit', { unitId: U2 }]]) {
  for (const [from, toEx] of [['2025-11-01', '2026-11-01'], ['2026-02-01', '2026-03-01']]) {
    const before = await sixQueries(from, toEx, scope);
    queries = 0;
    const after = await M.loadInputs(q, from, toEx, scope);
    const same = JSON.stringify(costsById(before)) === JSON.stringify(costsById(after));
    check(`loadInputs ${label}, ${from} to ${toEx}: identical in ${queries} ${queries === 1 ? 'query' : 'queries'} (${after.units.length} units, ${after.stays.length} stays, ${after.stays.filter(s => s.parts).length} paid by instalments, ${after.costs.length} costs, ${after.adjustments.length} adjustments, ${after.units.filter(u => u.history).length} with contract history)`,
      same && queries === 1 && after.stays.length > 0 && after.costs.length > 0);
  }
}
check('loadInputs sees the instalment stay, the adjustments and the contract history', (await M.loadInputs(q, '2025-11-01', '2026-11-01')).stays.some(s => s.parts?.length === 2)
  && (await M.loadInputs(q, '2025-11-01', '2026-11-01')).adjustments.length === 3 && (await M.loadInputs(q, '2025-11-01', '2026-11-01', { unitId: U3 })).units[0].history?.length === 3);

await sql.end();
db.kill();
console.log(fails ? `\n${fails} failed.` : '\nAll passed.');
process.exit(fails ? 1 : 0);
