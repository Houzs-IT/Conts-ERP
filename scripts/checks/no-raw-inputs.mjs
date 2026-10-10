// Fails when a screen uses a raw number or date/time input instead of src/components/inputs.
// A raw type="number" lets the mouse wheel change money, snaps an emptied field back to 0 and refuses "1,234.50";
// raw date/time inputs drift in height, label and range messages. Run: node scripts/checks/no-raw-inputs.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
const ALLOWED_DIR = join(SRC, 'components', 'inputs') + sep;
const KINDS = 'number|date|time|datetime-local|month|week';
const LITERAL = new RegExp(`\\btype\\s*=\\s*(?:\\{\\s*)?["'\`](${KINDS})["'\`]`, 'g');
const EXPRESSION = new RegExp(`\\btype\\s*=\\s*\\{[^}\\n]*["'\`](${KINDS})["'\`][^}\\n]*\\}`, 'g');

/** Line-numbered problems in one file's text. */
export function findRawInputs(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const hits = new Set();
    for (const re of [LITERAL, EXPRESSION]) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) hits.add(m[1]);
    }
    for (const kind of hits) out.push({ line: i + 1, kind });
  });
  return out;
}

const isRenovation = p => /(^|[\\/])reno[^\\/]*$/i.test(p);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) files.push(p);
  }
  return files;
}

function selfTest() {
  const planted = [
    '<input type="number" value={x} />',
    '<Field label="Amount" type=\'number\' />',
    '<input type={num ? \'number\' : \'text\'} />',
    '<Field label="Day" type="date" />',
    '<input type="time" />',
    '<input type="datetime-local" />',
  ].join('\n');
  const clean = [
    '<input type="text" inputMode="decimal" />',
    '// an old note about type="number"',
    "if (typeof value === 'number') return;",
    '<MoneyInput valueSen={x} onChangeSen={setX} />',
  ].join('\n');
  const found = findRawInputs(planted).length, falseHits = findRawInputs(clean).length;
  if (found !== 6 || falseHits !== 0) {
    console.error(`no-raw-inputs self-test failed: found ${found} of 6 planted, ${falseHits} false hits`);
    process.exit(2);
  }
}

selfTest();
const problems = [];
for (const file of walk(SRC)) {
  if (file.startsWith(ALLOWED_DIR) || isRenovation(file)) continue;
  for (const p of findRawInputs(readFileSync(file, 'utf8'))) problems.push(`${relative(ROOT, file)}:${p.line}  raw type="${p.kind}"`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\nno-raw-inputs: ${problems.length} raw number/date/time input(s). Use MoneyInput, NumberInput, PercentInput, DateField, TimeField or DateTimeField from src/components/inputs.`);
  process.exit(1);
}
console.log('no-raw-inputs: self-test passed, 0 raw number/date/time inputs');
