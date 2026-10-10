// Restores a backup made by scripts/backup-dump.sh (the nightly .github/workflows/backup.yml) into a database
// you name explicitly, then checks every table has the row count it had when the backup was taken.
//
//   node scripts/restore-backup.mjs --file=<backup .sql.gz.enc> [--check-only]
//   node scripts/restore-backup.mjs --file=<backup .sql.gz.enc> --prompt [--replace]
//   node scripts/restore-backup.mjs --file=<backup .sql.gz.enc> --target-file=.dev.vars.restore [--replace]
//
// The target connection string comes from --prompt (typed or pasted, never shown), from RESTORE_DATABASE_URL in the
// --target-file, or from the RESTORE_DATABASE_URL environment variable. Never from DATABASE_URL, so the database the
// migrations go to is not picked up by accident. The passphrase comes from BACKUP_PASSPHRASE or is asked for.
// --check-only decrypts and lists the tables and row counts without touching any database.
// A target that already has a pos schema is refused unless --replace is given (it drops pos and pos_migrations first).
// Production (project cweomoenhsjvsxfsmiiw) is refused unless --confirm-production="restore over production cweomoenhsjvsxfsmiiw".
// Prints table names and counts only, never data. See docs/DR-RUNBOOK.md.
import { readFileSync } from 'node:fs';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import postgres from 'postgres';

const PRODUCTION_REF = 'cweomoenhsjvsxfsmiiw';
const PRODUCTION_PHRASE = `restore over production ${PRODUCTION_REF}`;
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);
const stop = (msg) => { console.error(msg); process.exit(1); };

/* ----------------------------- hidden input ----------------------------- */
let piped = null;
async function pipedLine() {
  if (!piped) { let t = ''; for await (const c of process.stdin) t += c; piped = t.split(/\r?\n/); }
  return piped.shift() ?? '';
}
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
        if (ch === '\u0003') return done(() => reject(new Error('Cancelled. Nothing was restored.')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/* ------------------------------- the file ------------------------------- */
const file = arg('file');
if (!file) stop('Name the backup file: --file=<path to conts-pos-....sql.gz.enc>. Nothing was restored.');
let blob;
try { blob = readFileSync(file); } catch { stop(`Cannot read ${file}. Nothing was restored.`); }
if (blob.subarray(0, 8).toString('latin1') !== 'Salted__') stop(`${file} is not a backup made by scripts/backup-dump.sh. Nothing was restored.`);

const pass = process.env.BACKUP_PASSPHRASE ?? await askHidden('Backup passphrase (nothing will show), then Enter: ').catch((e) => stop(e.message));
// openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256: 8-byte salt after "Salted__", key and IV from PBKDF2.
let sqlText;
try {
  const salt = blob.subarray(8, 16);
  const kiv = pbkdf2Sync(pass, salt, 200000, 48, 'sha256');
  const d = createDecipheriv('aes-256-cbc', kiv.subarray(0, 32), kiv.subarray(32));
  sqlText = gunzipSync(Buffer.concat([d.update(blob.subarray(16)), d.final()])).toString('utf8');
} catch { stop('The passphrase is wrong, or the file is damaged. Nothing was restored.'); }

const expected = new Map([...sqlText.matchAll(/^-- rowcount (\S+) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
if (!expected.size) stop('The backup has no row counts in it, so it cannot be checked. Nothing was restored.');
const taken = sqlText.match(/^-- Conts ERP Property OS backup, (\S+)\./m)?.[1] ?? 'unknown time';
const total = [...expected.values()].reduce((a, b) => a + b, 0);
console.log(`Backup taken ${taken}: ${expected.size} tables, ${total.toLocaleString('en-MY')} rows.`);

if (flag('check-only')) {
  for (const [t, n] of [...expected].sort()) console.log(`  ${t.padEnd(40)} ${String(n).padStart(9)}`);
  console.log('Decrypted and read correctly. No database was touched.');
  process.exit(0);
}

/* ------------------------------ the target ------------------------------ */
let url;
if (flag('prompt')) url = (await askHidden('Paste the TARGET database connection string (nothing will show), then Enter: ').catch((e) => stop(e.message))).trim();
else if (arg('target-file')) {
  let vars = '';
  try { vars = readFileSync(arg('target-file'), 'utf8'); } catch { stop(`Cannot read ${arg('target-file')}. Nothing was restored.`); }
  url = vars.match(/^RESTORE_DATABASE_URL="?([^"\r\n]+)"?/m)?.[1];
} else url = process.env.RESTORE_DATABASE_URL;
if (!url) stop('No target given. Use --prompt, --target-file=<file with RESTORE_DATABASE_URL="...">, or set RESTORE_DATABASE_URL. Nothing was restored.');

const ref = url.match(/postgres\.([a-z0-9]{20})\b/)?.[1] ?? url.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null;
const shown = ref ?? url.replace(/\/\/[^@]*@/, '//***@');
console.log(`Target database: ${shown}`);
if (url.includes(PRODUCTION_REF) && arg('confirm-production') !== PRODUCTION_PHRASE) {
  stop(`That is PRODUCTION. Restoring replaces live data. If that is really what you want, add --confirm-production="${PRODUCTION_PHRASE}". Nothing was restored.`);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
let sql;
try { sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : 'require', onnotice: () => {} }); }
catch { stop('The target is not a valid connection string. Nothing was restored.'); }

const [{ n: existing }] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'pos'`;
if (existing > 0 && !flag('replace')) {
  await sql.end();
  stop(`The target already has ${existing} tables in schema pos. Add --replace to drop them and restore the backup in their place. Nothing was restored.`);
}

// psql-only lines (\restrict and \unrestrict from newer pg_dump) mean nothing to a plain SQL connection.
const body = sqlText.split('\n').filter((l) => !l.startsWith('\\')).join('\n');
const started = Date.now();
await sql.begin(async (tx) => {
  if (existing > 0) {
    await tx.unsafe('drop schema pos cascade');
    await tx.unsafe('drop table if exists public.pos_migrations');
  }
  await tx.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'pos_app') then create role pos_app login; end if; end $$`);
  await tx.unsafe(body);
  // The dump leaves ownership out (it is restored by whoever runs this); the app's role owns everything in pos,
  // as migration 0001 set up, and reads it with search_path = pos.
  await tx.unsafe(`alter schema pos owner to pos_app; alter role pos_app set search_path = pos`);
  await tx.unsafe(`do $$ declare r record; begin
    for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'pos' and c.relkind in ('r', 'p', 'S', 'v', 'm')
               -- a sequence that belongs to a column moves with its table
               and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i')) loop
      execute format('alter %s pos.%I owner to pos_app',
        case r.relkind when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.relname);
    end loop; end $$`);
});
console.log(`Restored in ${((Date.now() - started) / 1000).toFixed(1)} s. Checking row counts...`);

let bad = 0;
for (const [t, n] of [...expected].sort()) {
  const [schema, table] = t.split('.');
  const [{ c }] = await sql.unsafe(`select count(*)::int as c from "${schema}"."${table.replace(/"/g, '""')}"`);
  const ok = c === n;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'DIFF'} ${t.padEnd(40)} backup ${String(n).padStart(9)}  restored ${String(c).padStart(9)}`);
}
await sql.end();
if (bad) stop(`\n${bad} of ${expected.size} tables do not match. Do not rely on this restore.`);
console.log(`\nAll ${expected.size} tables match (${total.toLocaleString('en-MY')} rows). pos_app owns schema pos; set its password with node scripts/migrate-pg.mjs (POS_APP_PASSWORD) if this is a new database.`);
