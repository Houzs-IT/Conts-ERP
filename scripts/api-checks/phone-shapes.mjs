// How every guest phone in a database reads after phone(): counts by country and the shapes that still do not read
// as "+<code> <groups>". Digits are masked (only the shape is printed), so it is safe on real data.
//
// Run: 1. BIGDATA_PORT=55437 node scripts/api-checks/hostplatform-import.mjs <data folder> --serve   (leave it running)
//      2. DB=postgres://postgres:local@127.0.0.1:55437/postgres node scripts/api-checks/phone-shapes.mjs [path/to/other/format.ts]
// The optional path compares another phone() (e.g. an older copy of src/lib/phone.ts, or src/lib/format.ts before it moved) on the same rows.
import postgres from 'postgres';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
async function load(file) {
  const out = await build({ entryPoints: [file], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error', nodePaths: [join(root, 'node_modules')] });
  const tmp = mkdtempSync(join(tmpdir(), 'phone-'));
  writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
  return import(pathToFileURL(join(tmp, 'm.mjs')).href);
}

const sql = postgres(process.env.DB ?? 'postgres://postgres:local@127.0.0.1:55437/postgres', { max: 1 });
const rows = await sql`SELECT phone FROM guests WHERE phone IS NOT NULL AND btrim(phone) <> ''`;
await sql.end();

const mask = s => s.replace(/\d/g, '9');
const grouped = s => /^\+\d{1,3} \d/.test(s) && /\d[ -]\d/.test(s.slice(s.indexOf(' ') + 1));

const REF = await load(join(root, 'src/lib/phone.ts'));

async function report(label, file) {
  const M = await load(file);
  const P = M.parsePhone ? M : null;
  let ok = 0, standard = 0; const bad = new Map(); const byCode = new Map();
  for (const { phone } of rows) {
    const shown = M.phone(phone);
    const ref = REF.parsePhone(phone);
    if (ref?.possible && shown === ref.international) standard++;
    if (grouped(shown)) { ok++; const cc = shown.slice(1, shown.indexOf(' ')); byCode.set(cc, (byCode.get(cc) ?? 0) + 1); }
    else { const k = `${mask(phone.trim())}  ->  ${mask(shown)}`; bad.set(k, (bad.get(k) ?? 0) + 1); }
  }
  console.log(`\n${label}: ${ok} of ${rows.length} guest phones read as "+<code> <groups>"; ${standard} in their country's own grouping`);
  console.log('  by calling code:', [...byCode].sort((a, b) => b[1] - a[1]).map(([c, n]) => `+${c} ${n}`).join(', '));
  if (bad.size) console.log(`  not grouped (${rows.length - ok}), by shape:\n` + [...bad].sort((a, b) => b[1] - a[1]).map(([k, n]) => `    ${String(n).padStart(4)}  ${k}`).join('\n'));
  if (P) {
    const impossible = rows.filter(r => !P.parsePhone(r.phone)?.possible).length;
    console.log(`  impossible for their country (the server would refuse them if retyped): ${impossible}`);
  }
  return ok;
}

const extra = process.argv[2];
if (extra) await report(`other (${extra})`, resolve(extra));
const now = await report('this tree', join(root, 'src/lib/phone.ts'));
process.exit(now >= rows.length * 0.98 ? 0 : 1);
