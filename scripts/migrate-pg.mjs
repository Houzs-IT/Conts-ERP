// Applies migrations-pg/*.sql to the Supabase database, once each, and sets the
// password of the API's database role (pos_app).
//
//   node scripts/migrate-pg.mjs --dry-run                    show the target and what is pending (.dev.vars)
//   node scripts/migrate-pg.mjs --env-file=.dev.vars.production --dry-run
//   node scripts/migrate-pg.mjs --env-file=.dev.vars.production   apply
//
// DATABASE_URL: admin connection (the `postgres` user) from the environment or the vars
// file. POS_APP_PASSWORD: the password to give pos_app (needed on the first run and
// whenever you want to rotate it). SCM_ENGINE_PASSWORD: the same for scm_engine, optional. SAY WHICH DATABASE THIS IS BEFORE RUNNING IT.
// --env-file reads the URL straight from the file — no shell interpolation, so a
// mis-escaped one-liner can't mangle the value or dump it into a crash message.
// RE-RUN: safe. Applied files are checksummed and skipped; a changed file stops the run.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const DRY = process.argv.includes('--dry-run');
const envFile = process.argv.find((a) => a.startsWith('--env-file='))?.slice('--env-file='.length) ?? '.dev.vars';
const vars = (() => { try { return readFileSync(envFile, 'utf8'); } catch { return ''; } })();
const read = (n) => process.env[n] ?? vars.match(new RegExp(`^${n}="([^"]+)"`, 'm'))?.[1];
const url = read('DATABASE_URL');
if (!url) { console.error('DATABASE_URL not set (environment or .dev.vars). Nothing was applied.'); process.exit(1); }
const target = url.match(/postgres\.([a-z0-9]{20})/)?.[1] ?? url.replace(/\/\/[^@]*@/, '//***@');
console.log(`Target database: ${target}${DRY ? '  (dry run)' : ''}`);

let sql;
try {
  sql = postgres(url, { max: 1, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
} catch {
  // Never let a bad URL reach the default error handler: its message includes the raw
  // connection string (with password), and that would land in whatever captured this output.
  console.error(`DATABASE_URL is not a valid connection string (from ${envFile}). Nothing was applied.`);
  process.exit(1);
}
await sql`create table if not exists public.pos_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now())`;
await sql`alter table public.pos_migrations enable row level security`;
const applied = new Map((await sql`select filename, checksum from public.pos_migrations`).map((r) => [r.filename, r.checksum]));

let pending = 0;
for (const filename of readdirSync('migrations-pg').filter((f) => f.endsWith('.sql')).sort()) {
  const body = readFileSync(`migrations-pg/${filename}`, 'utf8');
  const checksum = createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
  const seen = applied.get(filename);
  if (seen && seen !== checksum) { console.error(`${filename} was edited after it ran. Add a new migration instead.`); await sql.end(); process.exit(1); }
  if (seen) continue;
  pending++;
  if (DRY) { console.log(`pending: ${filename}`); continue; }
  console.log(`applying: ${filename}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into public.pos_migrations (filename, checksum) values (${filename}, ${checksum})`;
  });
}

const pw = read('POS_APP_PASSWORD');
if (!DRY && pw) { await sql.unsafe(`alter role pos_app password '${pw.replace(/'/g, "''")}'`); console.log('pos_app password set.'); }
else if (!DRY) console.log('POS_APP_PASSWORD not given: pos_app password unchanged.');
// The supply chain engine's role (migration 0047), set the same way and only when a password is given.
const enginePw = read('SCM_ENGINE_PASSWORD');
if (!DRY && enginePw && (await sql`select 1 from pg_roles where rolname = 'scm_engine'`).length) {
  await sql.unsafe(`alter role scm_engine password '${enginePw.replace(/'/g, "''")}'`); console.log('scm_engine password set.');
}
console.log(pending === 0 ? 'Nothing to apply; the database is up to date.' : DRY ? `${pending} pending.` : `Applied ${pending}.`);
await sql.end();
