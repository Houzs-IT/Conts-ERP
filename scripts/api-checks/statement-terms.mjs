// The owner's money words (src/lib/statementTerms.ts): every statement line is named by the owner's Owner Income
// Report, never with the unit glued on or the import's "(owner workbook)" tag; the summary adds up; the generator and the
// rewording script write those words. Pure: no server or database needed.
//   node scripts/api-checks/statement-terms.mjs
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = async (entry) => {
  const out = await build({ entryPoints: [join(root, entry)], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
  const tmp = mkdtempSync(join(tmpdir(), 'terms-'));
  writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
  return import(pathToFileURL(join(tmp, 'm.mjs')).href);
};
const T = await load('src/lib/statementTerms.ts');
const S = await load('functions/_lib/ownerStatement.ts');

let fails = 0;
const check = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' :: ' + extra}`); };

// 1. Stored lines in the old import wording read as the report words, with no unit and no source tag.
const unit = 'Regalia A33A-09 (1)';
const old = [
  { line_type: 'gross', category: null, description: `${unit}: total revenue for 2026-08 (owner workbook)`, want: 'Hospitality Income' },
  { line_type: 'expense', category: 'utilities', description: `${unit}: Utilities (owner workbook)`, want: 'Utilities' },
  { line_type: 'expense', category: 'cleaning', description: `${unit}: Cleaning (owner workbook)`, want: 'Cleaning Fee' },
  { line_type: 'expense', category: 'other', description: `${unit}: Additional deductions (owner workbook)`, want: 'Additional Deduction' },
  { line_type: 'expense', category: 'other', description: `${unit}: Miscellaneous charges (owner workbook)`, want: 'Miscellaneous Charges' },
  { line_type: 'management_fee', category: null, description: `${unit}: company and agent share (owner workbook)`, want: 'To Operator' },
  { line_type: 'adjustment', category: 'workbook_payout', description: `${unit}: owner payout for 2026-05 (owner workbook, no breakdown)`, want: 'Payout to Owner' },
  { line_type: 'adjustment', category: 'workbook_payout', description: `${unit}: guaranteed rent top-up (owner workbook)`, want: 'Minimum Guarantee Top-up' },
  { line_type: 'management_fee', category: 'operator_share', description: '15% to operator', want: '15% To Operator' },
  { line_type: 'management_fee', category: 'operator_share', description: 'Management fee 10% of the rent', want: '10% To Operator' },
  { line_type: 'expense', category: 'misc', description: 'Miscellaneous charges (RM 100.00 x 96.67% occupancy)', want: 'Miscellaneous Charges' },
  { line_type: 'adjustment', category: 'guarantee_top_up', description: 'Minimum guarantee top-up (guaranteed RM 2800.00)', want: 'Minimum Guarantee Top-up' },
  { line_type: 'adjustment', category: 'fixed_rent', description: `${unit}: fixed monthly rent`, want: 'Fixed Rent' },
  { line_type: 'adjustment', category: 'owner_charge', description: 'MAINTENANCE FEE SEPT 26', want: 'MAINTENANCE FEE SEPT 26' },
];
for (const l of old) check(`term: "${l.description}" -> "${l.want}"`, T.lineTerm(l) === l.want, T.lineTerm(l));
for (const l of old) {
  const d = T.lineDetail({ ...l, unitLabel: unit });
  check(`detail carries no unit or tag: "${l.description}"`, d === null || (!d.includes(unit) && !/owner workbook/i.test(d)), String(d));
}
const stay = { line_type: 'gross', category: 'hospitality', description: `${unit} · Tan · 2026-08-31 to 2026-09-03 (2 nights in 2026-09)` };
check('stay: term is Hospitality Income', T.lineTerm(stay) === 'Hospitality Income', T.lineTerm(stay));
check('stay: detail is guest and dates without the unit', T.lineDetail({ ...stay, unitLabel: unit }) === 'Tan · 2026-08-31 to 2026-09-03 (2 nights in 2026-09)', T.lineDetail({ ...stay, unitLabel: unit }));
check('source reference is recognised', T.isSourceReference('Owner workbook') && !T.isSourceReference('INV-2026-0912'));

// 2. The rewording script's rules: old wording -> new, new wording -> untouched (idempotent), credits untouched.
for (const l of old) {
  const next = T.rewordStored({ ...l, unit_label: unit, grr: false });
  const settled = T.rewordStored({ ...l, description: next ?? l.description, unit_label: unit, grr: false });
  check(`reword is idempotent: "${l.description}"`, (settled ?? next ?? l.description) === (next ?? l.description), `${next} then ${settled}`);
  if (l.line_type !== 'adjustment' || ['guarantee_top_up', 'fixed_rent', 'workbook_payout'].includes(l.category)) {
    check(`reword gives the term: "${l.description}"`, (next ?? l.description) === l.want, String(next));
  }
}
check('reword: owner charge left alone', T.rewordStored({ line_type: 'adjustment', category: 'owner_charge', description: 'MAINTENANCE FEE SEPT 26' }) === null);
check('reword: guaranteed-rent unit top-up is a fixed rent top-up',
  T.rewordStored({ line_type: 'adjustment', category: 'workbook_payout', description: `${unit}: guaranteed rent top-up (owner workbook)`, unit_label: unit, grr: true }) === 'Fixed Rent Top-up');
check('reword: an expense\'s own text is kept', T.rewordStored({ line_type: 'expense', category: 'electricity', description: 'TNB Sep bill' }) === null);
check('reword: stay loses only the unit', T.rewordStored({ ...stay, unit_label: unit }) === 'Tan · 2026-08-31 to 2026-09-03 (2 nights in 2026-09)');

// 3. The summary reads in report order and adds up to the net payout.
const lines = [
  { line_type: 'gross', category: 'hospitality', description: 'A', amount: 499881 },
  { line_type: 'expense', category: 'electricity', description: 'TNB', amount: -60195 },
  { line_type: 'expense', category: 'cleaning_basic', description: 'Clean', amount: -72000 },
  { line_type: 'expense', category: 'misc', description: 'Miscellaneous Charges', amount: -9667 },
  { line_type: 'management_fee', category: 'operator_share', description: '15% To Operator', amount: -39712 },
  { line_type: 'adjustment', category: 'owner_charge', description: 'MAINTENANCE FEE SEPT 26', amount: -42394 },
];
const net = lines.reduce((n, l) => n + l.amount, 0);
const rows = T.summaryRows(lines, net);
const labels = rows.map(r => r.label);
check('summary order follows the report', JSON.stringify(labels) === JSON.stringify(['Gross Income', 'Basic Cleaning Fee', 'Electricity Usage', 'Miscellaneous Charges', 'Net Income', '15% To Operator', 'Payout Before O2 Adjustment', 'MAINTENANCE FEE SEPT 26', 'Net Payout to Owner']), labels.join(' | '));
const byLabel = Object.fromEntries(rows.map(r => [r.label, r.amount]));
check('summary: net income = gross - deductions', byLabel['Net Income'] === 499881 - 60195 - 72000 - 9667, String(byLabel['Net Income']));
check('summary: payout before adjustment + adjustment = net', byLabel['Payout Before O2 Adjustment'] - 42394 === net && byLabel['Net Payout to Owner'] === net);

// 4. The generator writes the words: no unit name in any line description.
const u = { id: 'u1', owner_id: 'o1', owner_name: 'O', unit_number: 'A33A-09 (1)', unit_code: null, property_name: 'Regalia', address: null, package: null, term: null,
  split_kind: null, split_value: null, unit_misc: 1, contract_id: 'c1', model: 'management', management_fee_pct: 15, grr_amount: null, starts_on: '2026-01-01', ends_on: null,
  minimum_guarantee: 300000, guarantee_starts_on: null, guarantee_ends_on: null, contract_misc: 1, revenue_model: 'management_guarantee' };
const terms = S.termsFor(u, 25);
const m = S.computeUnitMonth('2026-09', u, terms,
  [{ id: 'r1', unit_id: 'u1', check_in: '2026-09-02', check_out: '2026-09-06', collected_revenue: 100000, channel: 'airbnb', external_ref: 'HM1', guest_name: 'Tan' }],
  [{ id: 'e1', unit_id: 'u1', category: 'electricity', description: 'TNB Sep', amount: 5000, incurred_on: '2026-09-20', reference: null, task_kind: null }], [], 10000);
const descs = m.lines.map(l => l.description);
check('generator: no unit name in descriptions', descs.every(d => !d.includes('Regalia')), descs.join(' | '));
check('generator: operator line is "15% To Operator"', descs.includes('15% To Operator'), descs.join(' | '));
check('generator: top-up line is "Minimum Guarantee Top-up"', descs.includes('Minimum Guarantee Top-up'), descs.join(' | '));
check('generator: misc line is "Miscellaneous Charges"', descs.includes('Miscellaneous Charges'), descs.join(' | '));

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
