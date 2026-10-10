// Renovation demo data: cleanup from a terminal. The logic lives in renovation-demo-cleanup.browser.js
// (the snippet used on the live site); this runs that same file against an engine over HTTP. Its header
// lists exactly what cleanup removes, what it only cancels or archives, and what stays.
//
//   node scripts/demo/renovation-demo-cleanup.mjs --manifest=scripts/demo/manifests/<file>.json [--engine=URL] [--yes]
//   (with no --manifest it takes the newest file in scripts/demo/manifests/)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askConfirm, engineHeaders, parseArgs, runSnippet } from './engine-host.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log('node scripts/demo/renovation-demo-cleanup.mjs [--manifest=FILE] [--engine=URL] [--yes]'); process.exit(0); }
const here = dirname(fileURLToPath(import.meta.url));
let manifestPath = args.manifest ? resolve(args.manifest) : null;
if (!manifestPath) {
  const dir = join(here, 'manifests');
  const files = (() => { try { return readdirSync(dir).filter((f) => /^renovation-demo-manifest-.*\.json$/.test(f)); } catch { return []; } })();
  if (!files.length) { console.error('No manifest found in scripts/demo/manifests/. Pass --manifest=<file>.'); process.exit(1); }
  manifestPath = join(dir, files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)[0]);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.engine && manifest.engine !== args.engine) {
  console.error(`The manifest was written on ${manifest.engine}; this run targets ${args.engine}. Pass --engine=${manifest.engine}.`);
  process.exit(1);
}
console.log(`manifest: ${manifestPath}`);
const headers = await engineHeaders(args.engine);
const reportPath = manifestPath.replace(/\.json$/, '.cleanup.json');
const report = await runSnippet('./renovation-demo-cleanup.browser.js', {
  base: args.engine,
  headers,
  manifest,
  log: (...a) => console.log(...a),
  confirm: (q) => askConfirm(q, args),
  saveReport: (r, m) => { writeFileSync(reportPath, JSON.stringify(r, null, 2)); writeFileSync(manifestPath, JSON.stringify(m, null, 2)); },
});
if (report?.stopped) { console.log(`\nstopped: ${report.stopped}`); process.exit(report.stopped === 'cancelled' ? 0 : 1); }
console.log(`report: ${reportPath}`);
process.exit(report?.failed?.length ? 1 : 0);
