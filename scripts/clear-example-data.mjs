// Removes the example data a database was seeded with, so real data starts from empty. ONE-OFF and
// IRREVERSIBLE: it empties every business table (owners, buildings, units, bookings, guests, tasks,
// statements, messages, supply chain, Channex links ...). It keeps user accounts, settings, the
// integrations list, automations, saved views and the audit trail.
//
//   node scripts/clear-example-data.mjs --env-file=<file>                         list what would go (changes nothing)
//   node scripts/clear-example-data.mjs --env-file=<file> --apply --confirm=<ref> do it; <ref> is the project ref printed
//
// SAY WHICH DATABASE THIS IS BEFORE RUNNING IT. The listing prints the target project ref and every
// table with its row count. --apply refuses unless --confirm matches that ref, runs as one transaction
// (all or nothing), stops if emptying would reach a kept table, and writes one audit_log entry.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const KEEP = ['users', 'settings', 'integrations', 'automations', 'saved_views', 'audit_log', 'password_reset_tokens'];

const APPLY = process.argv.includes('--apply');
const confirm = process.argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);
const envFile = process.argv.find((a) => a.startsWith('--env-file='))?.slice('--env-file='.length);
if (!envFile) { console.error('Pass --env-file=<file>. Nothing was changed.'); process.exit(1); }
const vars = (() => { try { return readFileSync(envFile, 'utf8'); } catch { return ''; } })();
const url = process.env.DATABASE_URL ?? vars.match(/^DATABASE_URL="([^"]+)"/m)?.[1];
if (!url) { console.error(`DATABASE_URL not found in ${envFile}. Nothing was changed.`); process.exit(1); }
const target = url.match(/postgres\.([a-z0-9]{20})/)?.[1];
if (!target) { console.error('Could not read the project ref from DATABASE_URL. Nothing was changed.'); process.exit(1); }
console.log(`Target database: ${target}${APPLY ? '' : '  (listing only, nothing will be changed)'}`);

let sql;
try { sql = postgres(url, { max: 1, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require', onnotice: () => {} }); }
catch { console.error('DATABASE_URL is not a valid connection string. Nothing was changed.'); process.exit(1); }

const all = (await sql`select tablename from pg_tables where schemaname = 'pos' order by 1`).map((r) => r.tablename);
const clear = all.filter((t) => !KEEP.includes(t));
const count = async (t) => (await sql.unsafe(`select count(*)::int n from pos."${t}"`))[0].n;

// A kept table that points at a table being emptied would be emptied too (or block the run). Stop instead.
const fks = await sql`
  select cl.relname as child, pr.relname as parent from pg_constraint c
  join pg_class cl on cl.oid = c.conrelid join pg_class pr on pr.oid = c.confrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where c.contype = 'f' and n.nspname = 'pos'`;
const reached = fks.filter((f) => KEEP.includes(f.child) && clear.includes(f.parent));
if (reached.length) {
  console.error(`Stopped: kept table(s) point at tables that would be emptied: ${reached.map((f) => `${f.child} -> ${f.parent}`).join(', ')}. Nothing was changed.`);
  await sql.end(); process.exit(1);
}

const counts = {};
for (const t of clear) { const n = await count(t); if (n) counts[t] = n; }
const total = Object.values(counts).reduce((s, n) => s + n, 0);
console.log(`\nWould be EMPTIED (${Object.keys(counts).length} tables with rows, ${total} rows; ${clear.length - Object.keys(counts).length} more are already empty):`);
for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(28)} ${n}`);
console.log('\nKEPT as they are:');
for (const t of KEEP) if (all.includes(t)) console.log(`  ${t.padEnd(28)} ${await count(t)}`);

if (!APPLY) { console.log(`\nNothing was changed. To do it: add  --apply --confirm=${target}`); await sql.end(); process.exit(0); }
if (confirm !== target) { console.error(`\n--confirm must be exactly ${target}. Nothing was changed.`); await sql.end(); process.exit(1); }
if (!total) { console.log('\nNothing to remove.'); await sql.end(); process.exit(0); }

await sql.begin(async (tx) => {
  await tx.unsafe(`truncate table ${clear.map((t) => `pos."${t}"`).join(', ')} restart identity`);
  await tx`insert into pos.audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
    values (null, 'Owner (clear-example-data script)', 'data.example_cleared', 'database', ${target}, ${JSON.stringify(counts)}, null, 'script', ${new Date().toISOString()})`;
});
console.log(`\nDone. ${total} rows removed from ${Object.keys(counts).length} tables on ${target}. Users, settings and the audit trail were kept.`);
await sql.end();
