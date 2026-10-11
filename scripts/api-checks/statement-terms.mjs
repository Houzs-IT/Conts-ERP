// The owner's money words (src/lib/statementTerms.ts): every statement line is named by the owner's Owner Income
// Report, never with the unit glued on or the import's "(owner workbook)" tag; the generator's
// deduction rows are the report's. Pure: no server or database needed.
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

// 2. The generator's deduction rows are the report's, in its order.
check('generator deductions are the report rows', JSON.stringify(S.DEDUCTIONS) === JSON.stringify(T.DEDUCTION_TERMS) && S.DEDUCTIONS.length === 8);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
