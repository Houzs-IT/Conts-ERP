// Prints one month's owner statement figures for chosen units, worked out by functions/_lib/ownerStatement.ts against a
// running local database (BIGDATA_PORT). Used to show a before/after of a rule change: run it on the old and the new code.
//   node scripts/statement-compare.mjs <month YYYY-MM> <unitId,unitId,...> [path to ownerStatement.ts]
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [month, unitList, srcArg] = process.argv.slice(2);
const src = resolve(srcArg ?? join(root, 'functions/_lib/ownerStatement.ts'));
const out = await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error', nodePaths: [join(root, 'node_modules')] });
const tmp = mkdtempSync(join(tmpdir(), 'stmt-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

const PORT = Number(process.env.BIGDATA_PORT ?? 55434);
const sql = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' },
  types: { number: { to: 20, from: [20, 1700], serialize: x => String(x), parse: x => Number(x) } } });
const numbered = s => { let i = 0; return s.replace(/\?/g, () => `$${++i}`); };
const q = (s, ...args) => sql.unsafe(numbered(s), args);
const rm = n => (n / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
try {
  const start = `${month}-01`;
  const endEx = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10);
  const ids = unitList.split(',');
  const settings = await M.statementSettings(q);
  const inputs = await M.loadInputs(q, start, endEx, {});
  const months = M.computeMonth(month, inputs, settings, 'dated').filter(m => ids.includes(m.unitId));
  for (const m of months) {
    const u = inputs.units.find(x => x.id === m.unitId);
    console.log(JSON.stringify({ unit: `${u.property_name} ${u.unit_number}`, nights: m.nights, income: rm(m.gross), deductions: rm(m.deductions), net: rm(m.net),
      ownerShare: rm(m.ownerShare), payout: rm(m.netPayout), stays: m.lines.filter(l => l.type === 'gross').map(l => `${l.reference ?? ''} ${l.quantity}n ${rm(l.amount)}`) }));
  }
} finally { await sql.end(); }
