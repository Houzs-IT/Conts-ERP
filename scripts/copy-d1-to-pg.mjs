// One-off: copies every row from the Cloudflare D1 database into the Postgres (Supabase)
// `pos` schema, then checks that both sides hold the same rows.
//
//   node scripts/copy-d1-to-pg.mjs            PLAN: read D1, show counts, write nothing
//   node scripts/copy-d1-to-pg.mjs --apply    write, then verify
//   add --local [--persist-to <dir>] to read a local D1 copy instead of the remote one
//
// Needs `wrangler login` (reads D1) and DATABASE_URL (the pos_app connection string, from
// the environment or .dev.vars). SAY WHICH DATABASE THIS IS BEFORE YOU RUN --apply.
// Password hashes are copied as-is and never printed.
// RE-RUN: safe. Rows are upserted by primary key, so running twice gives the same result.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local');
const persist = process.argv.includes('--persist-to') ? process.argv[process.argv.indexOf('--persist-to') + 1] : null;
const vars = (() => { try { return readFileSync('.dev.vars', 'utf8'); } catch { return ''; } })();
const url = process.env.DATABASE_URL ?? vars.match(/^DATABASE_URL="([^"]+)"/m)?.[1];
if (!url) { console.error('DATABASE_URL not set (environment or .dev.vars). Nothing was done.'); process.exit(1); }
console.log(`Source: D1 ${LOCAL ? '(local copy)' : '(REMOTE, theconts-prod)'}`);
console.log(`Target: ${url.match(/pos_app\.([a-z0-9]{20})/)?.[1] ?? url.replace(/\/\/[^@]*@/, '//***@')}${APPLY ? '' : '  (plan only)'}`);

const sql = postgres(url, { max: 1, prepare: false, ssl: /127\.0\.0\.1|localhost/.test(url) ? false : 'require' });

// Tables in the order Postgres can accept them: a table comes after everything it references.
const tables = (await sql`select tablename from pg_tables where schemaname = 'pos' order by tablename`).map((r) => r.tablename);
const deps = await sql`
  select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where c.contype = 'f' and n.nspname = 'pos'`;
const after = new Map(tables.map((t) => [t, new Set()]));
for (const d of deps) { const child = d.child.replace(/^pos\./, ''), parent = d.parent.replace(/^pos\./, ''); if (child !== parent) after.get(child)?.add(parent); }
const order = [];
while (order.length < tables.length) {
  const next = tables.filter((t) => !order.includes(t) && [...after.get(t)].every((p) => order.includes(p)));
  if (!next.length) { console.error('Circular foreign keys between tables; cannot order the copy.'); process.exit(1); }
  order.push(...next);
}

// The wrangler CLI prints a SQL NULL as the string "null" in --json output, which Postgres
// rejects for number columns. No column in this schema holds the literal text "null", so
// the string is turned back into NULL (the count per table is printed).
const fromCli = (v) => (v === 'null' || v === undefined ? null : v);

const d1 = (query) => {
  const args = ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'theconts-prod', LOCAL ? '--local' : '--remote', '--json', '--config', 'scripts/d1-source.toml', '--command', query];
  if (persist) args.push('--persist-to', persist);
  const out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results ?? [];
};
const d1Tables = new Set(d1("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' and name != 'd1_migrations'").map((r) => r.name));

let mismatches = 0;
for (const t of order) {
  const cols = (await sql`select column_name from information_schema.columns where table_schema = 'pos' and table_name = ${t} order by ordinal_position`).map((r) => r.column_name);
  const pk = (await sql`
    select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${'pos.' + t}::regclass and i.indisprimary order by array_position(i.indkey, a.attnum)`).map((r) => r.attname);
  const rows = d1Tables.has(t) ? d1(`select * from "${t}"`) : [];
  const nulls = rows.reduce((n, r) => n + cols.filter((c) => r[c] === 'null').length, 0);
  console.log(`${t.padEnd(24)} D1 rows: ${String(rows.length).padStart(5)}${nulls ? `   (${nulls} "null" text values read as NULL)` : ''}`);
  if (!APPLY || !rows.length) continue;

  const list = cols.map((c) => `"${c}"`).join(', ');
  const set = cols.filter((c) => !pk.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
  const stmt = `insert into "${t}" (${list}) overriding system value values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
                on conflict (${pk.map((c) => `"${c}"`).join(', ')}) ${set ? `do update set ${set}` : 'do nothing'}`;
  try { await sql.begin(async (tx) => { for (const r of rows) await tx.unsafe(stmt, cols.map((c) => fromCli(r[c]))); }); }
  catch (e) { console.error(`  FAILED on table ${t}: ${e.message}`); throw e; }

  // Shape check, not just a count: the same primary keys must be on both sides.
  const key = (r) => pk.map((c) => r[c]).join('|');
  const have = new Set((await sql.unsafe(`select ${pk.map((c) => `"${c}"`).join(', ')} from "${t}"`)).map(key));
  const missing = rows.filter((r) => !have.has(key(r)));
  if (missing.length) { mismatches += missing.length; console.error(`  MISSING in Postgres: ${missing.length} row(s) of ${t}`); }
}
if (APPLY) {
  // audit_log has an identity id; continue numbering after the highest copied id.
  await sql.unsafe(`select setval(pg_get_serial_sequence('audit_log', 'id'), greatest(coalesce((select max(id) from audit_log), 0), 1))`);
  console.log(mismatches ? `\nVERIFY FAILED: ${mismatches} row(s) missing.` : '\nVerified: every D1 row is in Postgres.');
}
await sql.end();
process.exit(mismatches ? 1 : 0);
