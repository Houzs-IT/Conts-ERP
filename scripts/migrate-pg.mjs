// Applies migrations-pg/*.sql to the Supabase database, once each, and sets the
// password of the API's database role (pos_app).
//
//   node scripts/migrate-pg.mjs --dry-run                    show the target and what is pending (.dev.vars)
//   node scripts/migrate-pg.mjs --env-file=.dev.vars.production --dry-run
//   node scripts/migrate-pg.mjs --only=0049,0050              apply only those files, leave the rest pending
//   node scripts/migrate-pg.mjs --env-file=.dev.vars.production   apply
//   node scripts/migrate-pg.mjs --prompt --dry-run           ask for the connection string (hidden), show what is pending
//   node scripts/migrate-pg.mjs --prompt                     ask for it, show the target, apply after the project ref is typed back
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
// --prompt asks for the connection string on this terminal (typed or pasted, nothing is shown) instead of reading
// a vars file, so whoever holds the password can run a migration without it touching disk or shell history.
// Before anything is applied it prints the target project and asks for that project ref to be typed back.
const PROMPT = process.argv.includes('--prompt');

// Piped input (not a terminal): one answer per line, read once.
let piped = null;
async function pipedLine() {
  if (!piped) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    piped = text.split(/\r?\n/);
  }
  return piped.shift() ?? '';
}

/** Reads one line from the terminal without echoing it. Never logged, never written anywhere. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) { stdout.write(question + '\n'); pipedLine().then(resolve, reject); return; }
    stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let value = '';
    const done = (fn) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); stdout.write('\n'); fn(); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(value));
        if (ch === '\u0003') return done(() => reject(new Error('Cancelled. Nothing was applied.')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
async function askLine(question) {
  if (!process.stdin.isTTY) { process.stdout.write(question + '\n'); return (await pipedLine()).trim(); }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}
// --only=0049,0050 applies just the files starting with those numbers and leaves the other pending ones
// pending: for a change that must reach an environment before an earlier, larger one is due there.
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean) ?? null;
const envFile = process.argv.find((a) => a.startsWith('--env-file='))?.slice('--env-file='.length) ?? '.dev.vars';
const vars = (() => { try { return readFileSync(envFile, 'utf8'); } catch { return ''; } })();
// With --prompt nothing comes from a vars file: a local .dev.vars must never set a role password on the database typed in.
const read = (n) => process.env[n] ?? (PROMPT ? undefined : vars.match(new RegExp(`^${n}="([^"]+)"`, 'm'))?.[1]);
let url;
if (PROMPT) {
  try { url = (await askHidden('Paste the database connection string (nothing will show), then press Enter: ')).trim(); }
  catch (e) { console.error(e.message); process.exit(1); }
} else url = read('DATABASE_URL');
if (!url) { console.error(`DATABASE_URL not set (${PROMPT ? 'nothing was entered' : 'environment or .dev.vars'}). Nothing was applied.`); process.exit(1); }
// Supabase project ref: pooler URLs carry it in the user name (postgres.<ref>), direct ones in the host (db.<ref>.supabase.co).
const ref = url.match(/postgres\.([a-z0-9]{20})\b/)?.[1] ?? url.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null;
const target = ref ?? url.replace(/\/\/[^@]*@/, '//***@').replace(/:[^@/]*@/, ':***@');
console.log(`Target database: ${target}${DRY ? '  (dry run)' : ''}`);
if (PROMPT && !DRY) {
  const typed = await askLine(`Type the project ref (${ref ?? 'the host name shown above'}) to apply the pending migrations to it, or anything else to stop: `);
  if (typed !== (ref ?? target)) { console.error('That does not match. Nothing was applied.'); process.exit(1); }
}

let sql;
try {
  // Notices print as one line ('owners re-keyed to opaque ids: 104' from 0052), not as the driver's raw object.
  sql = postgres(url, { max: 1, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require', onnotice: (n) => console.log(`  note: ${n.message}`) });
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
  if (ONLY && !ONLY.some((n) => filename.startsWith(n))) { console.log(`left pending: ${filename}`); continue; }
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
