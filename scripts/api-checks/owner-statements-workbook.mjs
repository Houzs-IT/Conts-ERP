// Owner statements against the owner's own workbook: runs the statement computation (functions/_lib/ownerStatement.ts)
// on the imported data and compares it, unit by unit and month by month, with what the workbook paid.
//   - 整体报告 (the August report): income, cleaning, utilities, additional deductions, miscellaneous charges, payout
//   - OWNER PAYOUT: every unit's payout for every month the workbook has
//   - the owner's sample Owner Income Report (September, one unit): every line, and its year-to-date page
// Prints figures and unit numbers only (#1, #2 ...), never an owner, a guest or a unit name.
//
// Run: 1. BIGDATA_PORT=55453 node scripts/api-checks/hostplatform-import.mjs <data folder> --serve   (leave it running)
//      2. BIGDATA_PORT=55453 node scripts/api-checks/owner-statements-workbook.mjs <data folder> [--detail]
// The data folder (listing.csv, res-*.csv, airbnb-orders.xlsx) holds personal data: keep it outside the repository.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/api-checks/owner-statements-workbook.mjs <data folder> [--detail]'); process.exit(2); }
const detail = process.argv.includes('--detail');
// --ids prints the workbook unit id instead of #n (unit codes only, for working on this file; never paste the output anywhere).
const ids = process.argv.includes('--ids');
const PORT = Number(process.env.BIGDATA_PORT ?? 55433);

const out = await build({
  stdin: {
    contents: `export * from './functions/_lib/ownerStatement.ts'; export * from './functions/_lib/hostplatformImport.ts'; export * from './src/lib/sheets.ts';`,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'os-check-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

let fails = 0;
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${more ? ` :: ${more}` : ''}`); };
const rm = sen => (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sen = v => (typeof v === 'number' ? M.roundSen(v * 100) : null);

/* ---------- the workbook ---------- */
const xlsx = readdirSync(dir).find(f => /\.xlsx$/i.test(f));
const wb = await M.readXlsx(readFileSync(join(dir, xlsx)), ['整体报告', 'OWNER PAYOUT', '月度拆分']);
const report = M.sheetObjects(wb.sheets['整体报告'], 1, '整体报告').filter(r => /-/.test(String(r['LONG TERM'] ?? '')) && typeof r['OWNER PAYOUT'] === 'number');
const payoutRows = M.sheetObjects(wb.sheets['OWNER PAYOUT'], 1, 'OWNER PAYOUT');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP'];

/* ---------- the database ---------- */
const db = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
const numbered = s => { let i = 0; return s.replace(/\?/g, () => `$${++i}`); };
const q = (s, ...a) => db.unsafe(numbered(s), a);
const known = (await q('SELECT u.id, u.unit_number, u.property_id, p.name FROM units u JOIN properties p ON p.id = u.property_id'))
  .map(u => ({ id: u.id, unitNumber: u.unit_number, propertyId: u.property_id, propertyName: u.name }));
const match = M.workbookMatcher(known);
const settings = await M.statementSettings(q);

const t0 = performance.now();
const inputs = await M.loadInputs(q, '2026-01-01', '2026-10-01');
const byMonth = new Map();
for (let i = 1; i <= 9; i++) {
  const month = `2026-${String(i).padStart(2, '0')}`;
  byMonth.set(month, new Map(M.computeMonth(month, inputs, settings, 'dated').map(u => [u.unitId, u])));
}
console.log(`computed ${inputs.units.length} units x 9 months in ${Math.round(performance.now() - t0)} ms (${inputs.stays.length} stays, ${inputs.costs.length} costs, ${inputs.adjustments.length} owner adjustments)`);

const numberOf = new Map();
const wbIdOf = new Map();
const tag = id => { if (ids && wbIdOf.has(id)) return wbIdOf.get(id); if (!numberOf.has(id)) numberOf.set(id, numberOf.size + 1); return `#${numberOf.get(id)}`; };

/* ---------- 1. August, line by line (整体报告) ---------- */
const fields = [['income', 'TOTAL REVENUE', m => m.gross], ['cleaning', 'ALL CLEANING TOTAL', m => m.deductionGroups.filter(g => g.category.startsWith('cleaning')).reduce((n, g) => n + g.amount, 0)],
  ['utilities', 'UTILITIES', m => m.deductionGroups.filter(g => ['electricity', 'water', 'internet', 'sewerage'].includes(g.category)).reduce((n, g) => n + g.amount, 0)],
  ['additional', 'ADDITIONAL DEDUCTION', m => m.deductionGroups.find(g => g.category === 'additional').amount],
  ['misc', 'MISCELLANEOUS CHARGES', m => m.deductionGroups.find(g => g.category === 'misc').amount],
  ['payout', 'OWNER PAYOUT', m => m.netPayout]];
const aug = byMonth.get('2026-08');
const tally = Object.fromEntries(fields.map(([k]) => [k, { exact: 0, sen1: 0, off: 0 }]));
let augUnits = 0, augUnmatched = 0;
const augRows = [];
for (const r of report) {
  const unit = match(String(r['LONG TERM']).toUpperCase())?.unit;
  if (!unit) { augUnmatched++; continue; }
  wbIdOf.set(unit.id, String(r['LONG TERM']));
  const m = aug.get(unit.id);
  if (!m) { augUnmatched++; continue; }
  augUnits++;
  const row = { id: String(r['LONG TERM']), unit: unit.id, kind: Number(r['OWNER%']) ? `share ${Math.round(Number(r['OWNER%']) * 100)}%${Number(r['LT']) ? ' + guarantee' : ''}` : 'fixed rent', diffs: {} };
  for (const [k, col, get] of fields) {
    const want = sen(r[col]) ?? 0, got = get(m), d = got - want;
    row.diffs[k] = { want, got, d };
    const t = tally[k];
    if (d === 0) t.exact++; else if (Math.abs(d) <= 1) t.sen1++; else t.off++;
  }
  augRows.push(row);
}
console.log(`\n1. August (整体报告): ${augUnits} units compared, ${augUnmatched} not found in Property OS`);
for (const [k] of fields) console.log(`   ${k.padEnd(10)} exact ${tally[k].exact}, within 1 sen ${tally[k].sen1}, different ${tally[k].off}`);
if (detail) for (const r of augRows) {
  const bad = Object.entries(r.diffs).filter(([, v]) => v.d !== 0);
  if (bad.length) console.log(`   ${tag(r.unit)} (${r.kind}) ${bad.map(([k, v]) => `${k} ${rm(v.got)} vs ${rm(v.want)}`).join('; ')}`);
}

/* ---------- 1b. Income against the workbook's own night split (月度拆分, the sheet 订单合计月份 sums) ---------- */
// 整体报告 is a frozen copy taken from a fuller order list than this file's 订单数据; 月度拆分 is the same rule
// (金额 x nights in the month / nights) applied to the orders this file holds. Where a unit's orders are all here,
// the computed income must equal the split sheet's sum.
{
  const split = new Map();
  for (const r of M.sheetObjects(wb.sheets['月度拆分'], 1, '月度拆分')) {
    const id = String(r['Unit编号'] ?? '').toUpperCase(), m = M.toDate(r['月份'])?.slice(0, 7), v = r['金额(本月)'];
    if (!id || !m || typeof v !== 'number') continue;
    const k = `${id}|${m}`; split.set(k, (split.get(k) ?? 0) + v);
  }
  let same = 0, sen1 = 0, more = 0, less = 0, n = 0;
  for (const [k, v] of split) {
    const [id, month] = k.split('|');
    const unit = match(id)?.unit, m = unit && byMonth.get(month)?.get(unit.id);
    if (!m) continue;
    n++;
    const d = m.gross - M.roundSen(v * 100);
    if (d === 0) same++; else if (Math.abs(d) <= 1) sen1++; else if (d > 0) more++; else less++;
  }
  console.log(`\n1b. Income vs the workbook's own night split (月度拆分), ${n} unit-months: same ${same}, within 1 sen ${sen1}, Property OS higher ${more} (stays the workbook file does not list), lower ${less}`);
  check('income: the night split reproduces 月度拆分 for at least 80% of unit-months', (same + sen1) / (n || 1) >= 0.8, `${same + sen1} of ${n}`);
}

/* ---------- 2. Every month's payout (OWNER PAYOUT) ---------- */
let pay = { exact: 0, sen1: 0, off: 0 }, payUnits = 0;
const offByMonth = {}, perMonth = {};
const offRows = [];
for (const r of payoutRows) {
  const id = String(r['UNIT'] ?? '').toUpperCase();
  if (!id || /^\d+$/.test(id)) continue;
  const unit = match(id)?.unit;
  if (!unit) continue;
  MONTHS.forEach((col, i) => {
    const want = sen(r[col]);
    if (want === null || want === 0) return;
    const m = byMonth.get(`2026-${String(i + 1).padStart(2, '0')}`).get(unit.id);
    if (!m) return;
    payUnits++;
    const d = m.netPayout - want;
    const pm = (perMonth[col] ??= { n: 0, ok: 0 }); pm.n++; if (Math.abs(d) <= 1) pm.ok++;
    if (d === 0) pay.exact++; else if (Math.abs(d) <= 1) pay.sen1++; else { pay.off++; offByMonth[col] = (offByMonth[col] ?? 0) + 1; offRows.push({ unit: unit.id, col, want, got: m.netPayout, m }); }
  });
}
console.log(`\n2. Payouts (OWNER PAYOUT, Jan-Sep): ${payUnits} unit-months compared: exact ${pay.exact}, within 1 sen ${pay.sen1}, different ${pay.off} ${JSON.stringify(offByMonth)}`);
console.log(`   within 1 sen by month: ${MONTHS.map(c => `${c} ${perMonth[c]?.ok ?? 0}/${perMonth[c]?.n ?? 0}`).join(', ')}`);
console.log('   (the workbook file holds no bookings before March 2026, so January to March cannot be rebuilt from it)');
if (detail) for (const o of offRows) console.log(`   ${tag(o.unit)} ${o.col}: ${rm(o.got)} vs ${rm(o.want)} (diff ${rm(o.got - o.want)}; income ${rm(o.m.gross)}, deductions ${rm(o.m.deductions)}, ${o.m.terms.basis} ${o.m.terms.source})`);

/* ---------- 3. The owner's sample Owner Income Report, September ---------- */
const sampleUnit = match('TRION-A3503A')?.unit;
check('sample unit found', !!sampleUnit);
if (sampleUnit) {
  const sep = M.computeMonth('2026-09', { ...inputs, units: inputs.units.filter(u => u.id === sampleUnit.id) }, settings, 'dated').find(u => u.unitId === sampleUnit.id);
  const g = c => sep.deductionGroups.find(x => x.category === c);
  const rows = [
    ['Hospitality income: nights', 29, sep.nights, 'n'], ['occupancy %', 9667, Math.round(sep.occupancy * 10000), 'p'],
    ['Hospitality income', 499881, sep.gross], ['Basic cleaning: sessions', 9, g('cleaning_basic').quantity, 'n'], ['Basic cleaning', 72000, g('cleaning_basic').amount],
    ['Deep cleaning', 13800, g('cleaning_deep').amount], ['Electricity', 60195, g('electricity').amount], ['Water', 4979, g('water').amount],
    ['Wi-Fi', 10495, g('internet').amount], ['Indah Water', 0, g('sewerage').amount], ['Additional deduction', 64000, g('additional').amount],
    ['Miscellaneous charges', 9667, g('misc').amount], ['Total deduction', 235136, sep.deductions], ['Net income', 264745, sep.net],
    ['To operator', 39712, sep.operatorShare], ['Payout before O2', 225033, sep.payoutBeforeAdjustments], ['O2 adjustments', -42394, sep.adjustmentsTotal],
    ['Net payout to owner', 182639, sep.netPayout],
  ];
  console.log('\n3. Sample report, September (expected from the owner\'s PDF vs computed):');
  for (const [name, want, got, kind] of rows) {
    const f = v => (kind === 'n' ? String(v) : kind === 'p' ? `${(v / 100).toFixed(2)}%` : rm(v));
    console.log(`   ${want === got ? 'same' : 'DIFF'}  ${name.padEnd(26)} ${f(want).padStart(10)} ${f(got).padStart(10)}${want === got ? '' : `  (${kind ? got - want : rm(got - want)})`}`);
  }
  // What must hold whatever the data: the rule's arithmetic on this unit.
  check('sample: misc charge = RM 100 x occupancy', g('misc').amount === M.roundSen(10000 * sep.nights / 30), rm(g('misc').amount));
  check('sample: occupancy 29 of 30 nights', sep.nights === 29);
  check('sample: 15% to operator', sep.ownerPct === 85, String(sep.ownerPct));
  check('sample: lines add up', sep.gross - sep.deductions === sep.net && sep.net - sep.operatorShare === sep.payoutBeforeAdjustments && sep.payoutBeforeAdjustments + sep.adjustmentsTotal === sep.netPayout);
  check('sample: the O2 line is the September maintenance fee', sep.adjustmentsTotal === -42394, rm(sep.adjustmentsTotal));
  // The workbook file ends before the September cleaning records (清洁记录 stops at 31 Aug), the September Wi-Fi bill
  // and the RM 640 additional deduction were entered, so those three lines cannot be rebuilt from it; the bills it has must match.
  for (const c of ['electricity', 'water', 'sewerage']) check(`sample: ${c} as on the report`, g(c).amount === { electricity: 60195, water: 4979, sewerage: 0 }[c], rm(g(c).amount));
  const missing = ['cleaning_basic', 'cleaning_deep', 'internet', 'additional'].filter(c => g(c).amount === 0);
  console.log(`   not in the workbook file for September: ${missing.join(', ') || 'none'}`);

  // Year to date, Jan-Aug: GROSS INCOME / EXPENSE DEDUCTION / GROSS DEDUCTION (operator) / NET INCOME (payout before O2).
  const ytd = [[645906, 123344, 78384, 444178], [511898, 150860, 54156, 306882], [484702, 147226, 50621, 286855], [493122, 200542, 43887, 248693],
    [561378, 156329, 60757, 344292], [462701, 142273, 48064, 272364], [526405, 143870, 57381, 325154], [558036, 163815, 59133, 335088]];
  console.log('\n   Year to date (PDF page 2) vs computed, income / deduction / operator / net income:');
  let ytdExact = 0;
  ytd.forEach((w, i) => {
    const m = byMonth.get(`2026-${String(i + 1).padStart(2, '0')}`).get(sampleUnit.id);
    const got = [m.gross, m.deductions, m.operatorShare, m.payoutBeforeAdjustments];
    const same = got.every((v, j) => v === w[j]);
    if (same) ytdExact++;
    console.log(`   ${MONTHS[i]} ${same ? 'same' : 'DIFF'}  ${w.map(rm).join(' / ')}   |   ${got.map(rm).join(' / ')}`);
  });
  // January to March: the file has no bookings, so income (and the occupancy-scaled miscellaneous charge) is missing.
  check('sample: year-to-date Apr-Aug deductions as on the report', ytd.slice(3).every((w, i) => byMonth.get(`2026-${String(i + 4).padStart(2, '0')}`).get(sampleUnit.id).deductions === w[1]));
  check('sample: year-to-date Apr-Aug within 2 sen on every figure', ytd.slice(3).every((w, i) => { const m = byMonth.get(`2026-${String(i + 4).padStart(2, '0')}`).get(sampleUnit.id); return [m.gross, m.deductions, m.operatorShare, m.payoutBeforeAdjustments].every((v, j) => Math.abs(v - w[j]) <= 2); }));
  console.log(`   ${ytdExact} of 8 months identical on all four figures`);
}

/* ---------- 4. The rule on the sample's own figures ---------- */
// Feeds the September report's inputs (income 4,998.81 over 29 nights, its deductions and O2 line) through the same
// computation, so the arithmetic is checked independently of what the workbook file holds.
{
  const unit = { id: 'u', owner_id: 'o', owner_name: 'x', unit_number: 'A', unit_code: null, property_name: 'B', address: null, package: 'Package A', term: 'Short term',
    split_kind: 'Profit share', split_value: 85, unit_misc: 1, contract_id: null, model: null, management_fee_pct: null, grr_amount: null, starts_on: null, ends_on: null,
    minimum_guarantee: null, guarantee_starts_on: null, guarantee_ends_on: null, contract_misc: null };
  const stays = [{ id: 's', unit_id: 'u', check_in: '2026-09-01', check_out: '2026-09-30', collected_revenue: 499881, channel: 'airbnb', external_ref: null, guest_name: null }];
  const cost = (id, category, description, amount) => ({ id, unit_id: 'u', category, description, amount, incurred_on: '2026-09-15', reference: null, task_kind: null });
  const costs = [...Array.from({ length: 9 }, (_, i) => cost(`b${i}`, 'cleaning', 'Basic clean', 8000)), cost('d', 'cleaning', 'Deep clean', 13800), cost('e', 'electricity', 'bill', 60195),
    cost('w', 'water', 'bill', 4979), cost('i', 'internet', 'bill', 10495), cost('a', 'other', 'Additional Deduction', 64000)];
  const adj = [{ id: 'j', owner_id: 'o', unit_id: 'u', kind: 'charge', amount: -42394, description: 'O2: MAINTENANCE FEE SEPT 26', occurred_on: '2026-09-01', reference: null, state: 'open', statement_id: null }];
  const m = M.computeUnitMonth('2026-09', unit, M.termsFor(unit, 25), stays, costs, adj, 10000);
  const want = { gross: 499881, deductions: 235136, net: 264745, operatorShare: 39712, payoutBeforeAdjustments: 225033, adjustmentsTotal: -42394, netPayout: 182639 };
  const got = Object.fromEntries(Object.keys(want).map(k => [k, m[k]]));
  console.log(`\n4. The rule on the sample report's own inputs: ${Object.keys(want).map(k => `${k} ${rm(got[k])}${got[k] === want[k] ? '' : ` (report ${rm(want[k])})`}`).join(', ')}`);
  check('rule: the figures on the sample report follow exactly from its inputs', Object.keys(want).every(k => got[k] === want[k]));
  check('rule: misc charge 96.67 and occupancy 96.67%', m.deductionGroups.find(g => g.category === 'misc').amount === 9667 && Math.round(m.occupancy * 10000) === 9667);
}

/* ---------- 5. One unit-month per contract type, August ---------- */
{
  const cases = [['TRION-A3503A', 'profit share 85/15 ("15% to operator")'], ['AGILE-C3713A', 'profit share 75/20/5'], ['STAR-14510', 'profit share 85/10/5'],
    ['ARTE-MK20915', 'profit share with a monthly floor (GRR 2,200)'], ['SKYLINE-D1505', 'Package D, minimum prorated from 7 Aug'], ['SKYLINE-A1811', 'Package D above its minimum'],
    ['SKYLINE-B3201', 'Package D, minimum from 27 Aug'], ['CONTINEW-B5003', 'long term fixed rent'], ['SKYLINE-C3103A', 'long term fixed rent with an O2 charge'],
    ['M VERTICA-D1803', 'profit share with O2 credits (no contract record)']];
  console.log('\n5. August, one unit per contract type: workbook payout vs computed');
  for (const [id, what] of cases) {
    const r = report.find(x => String(x['LONG TERM']).toUpperCase() === id), unit = match(id)?.unit, m = unit && aug.get(unit.id);
    if (!r || !m) { console.log(`   ${what}: not found`); continue; }
    const want = sen(r['OWNER PAYOUT']);
    console.log(`   ${m.netPayout === want ? 'same' : Math.abs(m.netPayout - want) <= 1 ? '1sen' : 'DIFF'}  ${(ids ? id + ' ' : '') + what}: ${rm(want)} vs ${rm(m.netPayout)}${m.netPayout === want ? '' : `  (income ${rm(m.gross)} vs ${rm(sen(r['TOTAL REVENUE']))})`}`);
  }
}

/* ---------- gates ---------- */
const total = augUnits || 1;
check(`August payouts: at least 85% within 1 sen of 整体报告 (${tally.payout.exact + tally.payout.sen1} of ${augUnits})`, (tally.payout.exact + tally.payout.sen1) / total >= 0.85);
check(`August deductions: cleaning, utilities, misc within 1 sen for at least 90% of units`, ['cleaning', 'utilities', 'misc'].every(k => (tally[k].exact + tally[k].sen1) / total >= 0.9),
  ['cleaning', 'utilities', 'misc'].map(k => `${k} ${tally[k].exact + tally[k].sen1}`).join(', '));
const withData = ['MAY', 'JUN', 'JUL', 'AUG'].reduce((t, c) => ({ n: t.n + (perMonth[c]?.n ?? 0), ok: t.ok + (perMonth[c]?.ok ?? 0) }), { n: 0, ok: 0 });
check(`payouts May-Aug (months the file holds every booking for): at least 85% within 1 sen of OWNER PAYOUT (${withData.ok} of ${withData.n})`, withData.ok / (withData.n || 1) >= 0.85);

await db.end();
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
