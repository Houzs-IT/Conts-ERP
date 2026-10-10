// Runs the scheduled jobs (functions/_lib/cronJobs.ts) against a LOCAL database and prints what each would do.
// Nothing is written unless --apply is given. Never points at staging or production: a non-local address is refused.
//
//   node scripts/cron-dry-run.mjs                            every job, dry run, database 127.0.0.1:55433
//   node scripts/cron-dry-run.mjs --db=postgres://postgres:local@127.0.0.1:55433/postgres
//   node scripts/cron-dry-run.mjs --job=overdue-sweep        one job (channex-outbox, notification-outbox,
//                                                            repair-blocks, overdue-sweep, daily-digest)
//   node scripts/cron-dry-run.mjs --apply                    really run them (local database only)
//   node scripts/cron-dry-run.mjs --at=2026-10-11T00:00:00Z  pretend it is that moment
import { mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const apply = process.argv.includes('--apply');
const db = arg('db') ?? process.env.CRON_DB ?? 'postgres://postgres:local@127.0.0.1:55433/postgres';
const host = new URL(db).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error(`Refused: ${host} is not a local database. This script only runs against a local copy.`);
  process.exit(2);
}
const at = arg('at') ? new Date(arg('at')) : new Date();
if (Number.isNaN(at.getTime())) { console.error('--at must be an ISO time, e.g. 2026-10-11T00:00:00Z'); process.exit(2); }

// The Worker code imports without file extensions; bundle it once so Node can load it.
const out = join(mkdtempSync(join(tmpdir(), 'cron-dry-')), 'jobs.mjs');
await build({ entryPoints: [join(root, 'functions/_lib/cronJobs.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const J = await import(pathToFileURL(out).href);

const env = { HYPERDRIVE: { connectionString: db }, SESSION_SECRET: 'unused' };
const all = { 'channex-outbox': J.channexOutbox, 'notification-outbox': J.drainOutbox, 'repair-blocks': J.repairBlockSweep, 'overdue-sweep': J.overdueSweep, 'daily-digest': J.dailyDigest };
const pick = arg('job');
if (pick && !all[pick]) { console.error(`Unknown job ${pick}. One of: ${Object.keys(all).join(', ')}`); process.exit(2); }
const jobs = pick ? [all[pick]] : Object.values(all);

console.log(`${apply ? 'RUN' : 'DRY RUN'} against ${host} at ${at.toISOString()} (${new Date(at.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} MYT)\n`);
const t0 = Date.now();
const reports = await J.runJobs(env, jobs, { dryRun: !apply, now: at });
for (const r of reports) {
  console.log(`[${r.job}] ${r.summary}${r.error ? `  ERROR: ${r.error}` : ''}`);
  for (const i of (r.items ?? []).slice(0, 12)) console.log(`    - ${i}`);
  if ((r.items ?? []).length > 12) console.log(`    ... and ${r.items.length - 12} more`);
}
console.log(`\n${reports.filter(r => r.error).length ? 'Some jobs failed.' : 'All jobs ran.'} ${Date.now() - t0} ms.${apply ? '' : ' Nothing was written.'}`);
process.exit(reports.some(r => r.error) ? 1 : 0);
