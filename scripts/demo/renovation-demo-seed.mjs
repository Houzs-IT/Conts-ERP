// Renovation demo data: seed from a terminal. The logic lives in renovation-demo-seed.browser.js (the
// snippet the owner pastes on the live site); this runs that same file against an engine over HTTP.
//
//   node scripts/demo/renovation-demo-seed.mjs                      local engine on :8790 (wrangler dev)
//   node scripts/demo/renovation-demo-seed.mjs --engine=http://127.0.0.1:8797 --yes
//   ENGINE_TOKEN=... node scripts/demo/renovation-demo-seed.mjs --engine=https://<engine>   asks you to type the host
//
// Options: --again (seed even though DEMO projects exist), --yes (no prompt; local engines only),
// --manifest=<file> (default scripts/demo/manifests/renovation-demo-manifest-<host>-<time>.json).
// See the header of renovation-demo-seed.browser.js for what it creates, and
// renovation-demo-cleanup.browser.js for what cleanup can and cannot undo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askConfirm, engineHeaders, parseArgs, runSnippet } from './engine-host.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(readHelp()); process.exit(0); }
function readHelp() { return 'node scripts/demo/renovation-demo-seed.mjs [--engine=URL] [--again] [--yes] [--manifest=FILE]'; }

const here = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const manifestPath = resolve(args.manifest ?? `${here}/manifests/renovation-demo-manifest-${new URL(args.engine).host.replace(/[^a-z0-9.-]/gi, '_')}-${stamp}.json`);
mkdirSync(dirname(manifestPath), { recursive: true });

const started = Date.now();
const headers = await engineHeaders(args.engine);
const result = await runSnippet('./renovation-demo-seed.browser.js', {
  base: args.engine,
  headers,
  log: (...a) => console.log(...a),
  confirm: (q) => askConfirm(q, args),
  saveManifest: (m) => writeFileSync(manifestPath, JSON.stringify(m, null, 2)),
}, { again: args.again });

if (result?.stopped) { console.log(`\nstopped: ${result.stopped}`); process.exit(result.stopped === 'cancelled' ? 0 : 1); }
console.log(`\nmanifest: ${manifestPath}`);
console.log(`took ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(result?.manifest?.warnings?.length ? 1 : 0);
