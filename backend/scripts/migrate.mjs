// Applies migrations/*.sql once each, in filename order, recording the file name
// and a checksum in app._migrations. Already-applied files are checked and
// skipped; a changed file stops the run rather than silently re-applying.
//
//   node scripts/migrate.mjs            apply pending
//   node scripts/migrate.mjs --dry-run  list pending, change nothing
//
// The target is DATABASE_URL: the env var if set, else the one in .dev.vars.
// SAY OUT LOUD WHICH DATABASE THAT IS BEFORE YOU RUN IT.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postgres from 'postgres';

const DRY = process.argv.includes('--dry-run');
const DIR = 'migrations';

function resolveUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    return readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL="([^"]+)"/)?.[1];
  } catch {
    return undefined;
  }
}

const url = resolveUrl();
if (!url) {
  console.error('DATABASE_URL not set (env var or .dev.vars). Nothing was applied.');
  process.exit(1);
}

const target = url.match(/postgres\.([a-z0-9]{20})/)?.[1] ?? url.replace(/\/\/[^@]*@/, '//***@');
console.log(`Target database: ${target}${DRY ? '  (dry run)' : ''}`);

const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes('localhost') ? undefined : 'require' });

await sql`create schema if not exists app`;
await sql`
  create table if not exists app._migrations (
    filename    text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
  )
`;

const applied = new Map(
  (await sql`select filename, checksum from app._migrations`).map((r) => [r.filename, r.checksum]),
);

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
let pending = 0;

for (const filename of files) {
  const body = readFileSync(path.join(DIR, filename), 'utf8');
  const checksum = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const seen = applied.get(filename);

  if (seen && seen !== checksum) {
    console.error(`\n${filename} was edited after it ran. Applied migrations must never change.`);
    console.error('Add a new migration instead. Nothing further was applied.');
    await sql.end();
    process.exit(1);
  }
  if (seen) continue;

  pending++;
  if (DRY) {
    console.log(`pending: ${filename}`);
    continue;
  }
  console.log(`applying: ${filename}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into app._migrations (filename, checksum) values (${filename}, ${checksum})`;
  });
}

console.log(pending === 0 ? 'Nothing to apply; the database is up to date.' : DRY ? `${pending} pending.` : `Applied ${pending}.`);
await sql.end();
