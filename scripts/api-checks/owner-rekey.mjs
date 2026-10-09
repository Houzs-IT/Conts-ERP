// Migration 0052's owner re-key, end to end on PGlite, with the real export files. Prints counts only.
//
// 1. Applies migrations up to 0051 and runs the import as it was on main before 0052 (git show <ref>), which keyed
//    owners by IC number ('wb-owner-<ic>') — what production holds today. Adds a statement, payout, line, thread,
//    document, audit and notification row and a portal login on such owners, so every kind of reference is moved.
// 2. Applies 0052. Checks: no owner id holds an IC-like number or a name, no reference is orphaned, the logins and
//    audit rows followed, the SQL hash equals the importer's, and the re-key block run again changes nothing.
// 3. Runs today's import twice on top: it finds the re-keyed owners (no duplicates), and run 2 creates nothing.
// 4. Stand-in production: an empty database with 0001-0051 recorded in public.pos_migrations, then
//    `node scripts/migrate-pg.mjs --prompt --dry-run` (connection string piped in) must list 0052 and later migrations only.
//
// Run: node scripts/api-checks/owner-rekey.mjs <data folder> [--old-ref=origin/main~N]
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/api-checks/owner-rekey.mjs <data folder> [--old-ref=<git ref>]'); process.exit(2); }
// The import code as production ran it on 8 Oct: main before this branch's first commit.
const oldRef = process.argv.find(a => a.startsWith('--old-ref='))?.slice(10)
  ?? execFileSync('git', ['merge-base', 'origin/main', 'd670c71'], { cwd: root }).toString().trim();
const LIB = ['functions/_lib/hostplatformImport.ts', 'functions/_lib/hostplatformImportDb.ts', 'src/lib/sheets.ts'];

async function bundle(from) {
  const out = await build({
    stdin: { contents: LIB.map(f => `export * from './${f}';`).join('\n'), resolveDir: from, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  });
  const t = mkdtempSync(join(tmpdir(), 'rekey-'));
  writeFileSync(join(t, 'm.mjs'), out.outputFiles[0].text);
  return import(pathToFileURL(join(t, 'm.mjs')).href);
}
const oldDir = mkdtempSync(join(tmpdir(), 'rekey-old-'));
for (const f of LIB) {
  mkdirSync(join(oldDir, dirname(f)), { recursive: true });
  writeFileSync(join(oldDir, f), execFileSync('git', ['show', `${oldRef}:${f}`], { cwd: root }));
}
const OLD = await bundle(oldDir), NEW = await bundle(root);
console.log(`old import code: ${oldRef.slice(0, 10)}`);

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };

/* ---------- files ---------- */
const files = readdirSync(dir);
const xlsx = files.find(f => /\.xlsx$/i.test(f));
const csv = (M, f, cols) => M.pick(M.csvObjects(readFileSync(join(dir, f), 'utf8')).rows, cols);
const book = async M => M.readXlsx(readFileSync(join(dir, xlsx)), Object.values(M.WORKBOOK_SHEETS));
const sheetsFor = async M => {
  const wb = await book(M), S = M.WORKBOOK_SHEETS;
  const read = name => M.pick(name === S.pool && M.poolSheetRows ? M.poolSheetRows(wb.sheets[name] ?? []) : M.sheetObjects(wb.sheets[name] ?? [], M.WORKBOOK_HEADER_ROW[name] ?? 1, name), M.WORKBOOK_COLUMNS[name]);
  return Object.fromEntries(Object.entries(S).map(([k, n]) => [k, read(n)]));
};

/* ---------- database ---------- */
const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const { default: postgres } = await import('postgres');
const migrations = readdirSync(join(root, 'migrations-pg')).filter(f => f.endsWith('.sql')).sort();
const body = f => readFileSync(join(root, 'migrations-pg', f), 'utf8');

const pg = new PGlite();
await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'pos_app') then create role pos_app login; end if; end $$;`);
for (const f of migrations.filter(f => f < '0052')) {
  try { await pg.exec(`begin;\n${body(f)}\ncommit;`); } catch { await pg.exec('rollback;').catch(() => {}); }
}
await pg.exec('set search_path = pos');
const now0 = new Date().toISOString();
await pg.exec(`insert into owners (id, display_name, email, created_at, updated_at) values ('pilot-owner', 'Pilot owner', '', '${now0}', '${now0}');
  insert into properties (id, name, address_line, city, state, created_at, updated_at) values ('pilot-prop', 'Regalia', 'Jalan Sultan Ismail', 'Kuala Lumpur', 'WP', '${now0}', '${now0}');`);
const PORT = Number(process.env.REKEY_PORT ?? 55461);
const server = new PGLiteSocketServer({ db: pg, port: PORT });
await server.start();
const numbered = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const wire = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, {
  max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' },
  types: { number: { to: 20, from: [20, 1700], serialize: x => String(x), parse: x => Number(x) } },
});
const db = { all: async (sql, ...a) => wire.unsafe(numbered(sql), a), run: async (sql, ...a) => { await wire.unsafe(numbered(sql), a); } };
const q = async sql => (await pg.query(sql)).rows;
const one = async sql => (await q(sql))[0];

/* ---------- 1. the old import ---------- */
const today = NEW.todayInKL(), now = new Date().toISOString();
{
  const W = await sheetsFor(OLD);
  await OLD.importListing(db, OLD.mapListing(csv(OLD, 'listing.csv', OLD.LISTING_COLUMNS)), now);
  await OLD.importWorkbookUnits(db, OLD.mapWorkbookUnits(W.units, W.splits, W.pool).units, now);
}
// IC-like: the IC pattern anywhere in the id, unless the id is an opaque hash (16 hex characters hold 12 digits in a
// row by chance in about 1 id in 100; that is a hash, not an IC, and is counted separately).
const OPAQUE = `id ~ '^(wb|hp)-owner-[0-9a-f]{16}$'`;
const IC_LIKE = `((id ~ '\\d{6}-\\d{2}-\\d{4}' or id ~ '\\d{12}') and not ${OPAQUE})`;
const before = await one(`select count(*)::int n, count(*) filter (where ${IC_LIKE})::int ic_like,
  count(*) filter (where (id like 'wb-owner-%' or id like 'hp-owner-%') and id <> 'hp-owner-to-be-confirmed')::int imported from owners`);
console.log(`\nafter the old import: ${before.n} owners, ${before.imported} with an imported id, ${before.ic_like} of them with an IC-like id`);
check('the old import made IC-like owner ids (what production has)', before.ic_like > 0, `${before.ic_like}`);

// One of every kind of reference, on the first three IC-keyed owners.
const victims = (await q(`select id from owners where ${IC_LIKE} order by id limit 3`)).map(r => r.id);
await pg.query(`insert into users (id, email, full_name, password_hash, role, must_change_password, created_at, updated_at) values ('portal-1', 'portal@local.test', 'Portal owner', 'x', 'owner', 0, $1, $1)`, [now]);
await pg.query(`update owners set user_id = 'portal-1' where id = $1`, [victims[0]]);
for (const [i, o] of victims.entries()) {
  await pg.query(`insert into owner_statements (id, owner_id, period_start, period_end, state, generated_at, created_at) values ($1, $2, '2026-07-01', '2026-07-31', 'paid', $3, $3)`, [`t-st-${i}`, o, now]);
  await pg.query(`insert into statement_lines (id, statement_id, line_type, description, occurred_on, amount) values ($1, $2, 'adjustment', 'test', '2026-07-31', 100)`, [`t-sl-${i}`, `t-st-${i}`]);
  await pg.query(`insert into payouts (id, statement_id, owner_id, amount, created_at) values ($1, $2, $3, 100, $4)`, [`t-po-${i}`, `t-st-${i}`, o, now]);
  await pg.query(`insert into message_threads (id, owner_id, last_message_at) values ($1, $2, $3)`, [`t-th-${i}`, o, now]);
  await pg.query(`insert into documents (id, kind, file_name, mime_type, byte_size, storage_key, owner_id, created_at) values ($1, 'contract', 'x.pdf', 'application/pdf', 1, 'k', $2, $3)`, [`t-doc-${i}`, o, now]).catch(e => console.log('   (documents row not added:', e.message.slice(0, 60), ')'));
  await pg.query(`insert into audit_log (actor_label, action, entity_table, entity_id, after_state, occurred_at) values ('test', 'owner.update', 'owners', $1, $2, $3)`, [o, JSON.stringify({ ownerId: o }), now]);
  await pg.query(`insert into notification_log (id, template, recipient, channel, entity_table, entity_id, idempotency_key, queued_at) values ($1, 't', 'r', 'email', 'owners', $2, $1, $3)`, [`t-nl-${i}`, o, now]).catch(e => console.log('   (notification row not added:', e.message.slice(0, 60), ')'));
}
const fkCols = await q(`select c.conrelid::regclass::text tbl, a.attname col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'pos.owners'::regclass`);
const refCount = async ids => {
  let n = 0;
  for (const f of fkCols) n += (await pg.query(`select count(*)::int n from ${f.tbl} where ${f.col} = any($1)`, [ids])).rows[0].n;
  return n;
};
const refsBefore = await refCount(victims);
const unitsBefore = await one(`select count(*)::int n from units`);

/* ---------- 2. migration 0052 ---------- */
const m52 = migrations.find(f => f.startsWith('0052'));
await pg.exec(`begin;\n${body(m52)}\ncommit;`);
await pg.exec('set search_path = pos');
const after = await one(`select count(*)::int n, count(*) filter (where ${IC_LIKE})::int ic_like,
  count(*) filter (where (id like 'wb-owner-%' or id like 'hp-owner-%') and id <> 'hp-owner-to-be-confirmed' and id !~ '^(wb|hp)-owner-[0-9a-f]{16}$')::int not_opaque from owners`);
const chance = (await one(`select count(*)::int n from owners where ${OPAQUE} and id ~ '\\d{12}'`)).n;
console.log(`\nafter 0052: ${after.n} owners, IC-like ids ${after.ic_like}, other non-opaque imported ids ${after.not_opaque}; opaque ids that happen to hold 12 digits in a row: ${chance}`);
check('0 owners with an IC-like id', after.ic_like === 0, `${after.ic_like}`);
check('0 imported owners left on a non-opaque id (names, passport numbers)', after.not_opaque === 0, `${after.not_opaque}`);
check('no owner was lost or duplicated', after.n === before.n, `${before.n} -> ${after.n}`);
let orphans = 0;
for (const f of fkCols) {
  const n = (await one(`select count(*)::int n from ${f.tbl} t where t.${f.col} is not null and not exists (select 1 from owners o where o.id = t.${f.col})`)).n;
  if (n) console.log(`   orphans in ${f.tbl}.${f.col}: ${n}`);
  orphans += n;
}
check(`every reference to an owner is intact (${fkCols.length} foreign keys: ${fkCols.map(f => `${f.tbl}.${f.col}`).join(', ')})`, orphans === 0, `${orphans} orphans`);
check('nothing still points at an old id', (await refCount(victims)) === 0);
const moved = await one(`select (select count(*) from owner_statements where id like 't-st-%' and owner_id !~ '\\d{6}-')::int st,
  (select count(*) from payouts where id like 't-po-%' and owner_id !~ '\\d{6}-')::int po,
  (select count(*) from message_threads where id like 't-th-%' and owner_id !~ '\\d{6}-')::int th,
  (select count(*) from audit_log where entity_table = 'owners' and actor_label = 'test' and entity_id !~ '\\d{6}-' and after_state !~ '\\d{6}-\\d{2}-')::int au,
  (select count(*) from notification_log where id like 't-nl-%' and entity_id !~ '\\d{6}-')::int nl,
  (select count(*) from owners where user_id = 'portal-1')::int login, (select count(*) from units)::int units`);
console.log(`   moved: ${JSON.stringify(moved)}; references to the 3 test owners before: ${refsBefore}`);
check('statements, payouts, threads, audit and notification rows followed the owner', moved.st === 3 && moved.po === 3 && moved.th === 3 && moved.au === 3 && moved.nl === 3, JSON.stringify(moved));
check('the portal login followed the owner', moved.login === 1);
check('units unchanged in number', moved.units === unitsBefore.n);
// The SQL hash and the importer's must agree for every owner.
let agree = 0, differ = 0;
for (const o of await q(`select id, ic_number, display_name from owners where (id like 'wb-owner-%' or id like 'hp-owner-%') and id <> 'hp-owner-to-be-confirmed'`)) {
  const js = o.id.startsWith('hp-') ? await NEW.listingOwnerId(o.display_name) : await NEW.opaqueOwnerId('wb-owner-', NEW.ownerKeyFromIc(o.ic_number) || NEW.ownerKeyFromName(o.display_name));
  if (js === o.id) agree++; else differ++;
}
check(`the importer computes the same id as the migration for every re-keyed owner (${agree})`, differ === 0 && agree > 0, `${differ} differ`);
const block = body(m52).split('-- REKEY-BEGIN')[1].split('-- REKEY-END')[0];
const ids1 = (await q(`select id from owners order by id`)).map(r => r.id).join();
await pg.exec(`begin;\n${block}\ncommit;`);
check('the re-key block run again changes nothing', (await q(`select id from owners order by id`)).map(r => r.id).join() === ids1);

/* ---------- 3. today's import, twice ---------- */
// Later migrations on this branch first (0054 adds units.misc_charges, which today's importer writes).
for (const f of migrations.filter(f => f > m52)) { await pg.exec(`begin;
${body(f)}
commit;`); await pg.exec('set search_path = pos'); console.log(`applied ${f} before today's import`); }
const W = await sheetsFor(NEW);
const listing = csv(NEW, 'listing.csv', NEW.LISTING_COLUMNS);
const reservations = files.filter(f => /^res.*\.csv$/i.test(f)).sort().flatMap(f => csv(NEW, f, NEW.RESERVATION_COLUMNS));
const chunks = (xs, n) => { const o = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };
async function importAll() {
  const t = new Date().toISOString(); let created = 0;
  const add = r => { created += r.created; };
  add(await NEW.importListing(db, NEW.mapListing(listing), t));
  add(await NEW.importWorkbookUnits(db, NEW.mapWorkbookUnits(W.units, W.splits, W.pool, today).units, t, today));
  for (const c of chunks(reservations, 200)) add(await NEW.importReservations(db, NEW.mapReservations(c, today), t));
  for (const c of NEW.chunkByKey(W.airbnb, r => String(r['确认码'] ?? ''), 200)) add(await NEW.importAirbnbEarnings(db, NEW.mapAirbnbEarnings(c).earnings, today, t));
  for (const c of chunks(W.cleaning, 200)) add(await NEW.importCleaning(db, NEW.mapCleaning(c, W.cleaningPrices).cleanings, today, t));
  for (const c of chunks([...W.water, ...W.electricity, ...W.internet, ...W.sewerage, ...W.misc], 200)) { const m = NEW.mapWorkbookExpenses(c); add(await NEW.importExpenses(db, m.expenses, t, m.credits)); }
  add(await NEW.importPayoutHistory(db, NEW.mapPayoutHistory(W.payouts, W.report, today).months, t));
  return created;
}
const tables = ['owners', 'owner_contracts', 'units', 'reservations', 'owner_statements', 'payouts', 'owner_adjustments'];
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await one(`select count(*)::int n from ${t}`)).n])));
const ownersBeforeImport = (await one(`select count(*)::int n from owners`)).n;
const c1 = await importAll(), k1 = await counts();
const c2 = await importAll(), k2 = await counts();
console.log(`\nre-import: run 1 created ${c1} rows (main tables), run 2 created ${c2}; owners ${ownersBeforeImport} -> ${k1.owners} -> ${k2.owners}`);
console.log(`   counts after run 1 ${JSON.stringify(k1)}`);
check('re-import finds the re-keyed owners: no owner added', k1.owners === ownersBeforeImport, `${ownersBeforeImport} -> ${k1.owners}`);
check('run 2 creates nothing', c2 === 0 && JSON.stringify(k1) === JSON.stringify(k2), `${c2}`);
const final = await one(`select count(*) filter (where ${IC_LIKE})::int ic_like from owners`);
check('still 0 owners with an IC-like id after re-import', final.ic_like === 0);
let orphans2 = 0;
for (const f of fkCols) orphans2 += (await one(`select count(*)::int n from ${f.tbl} t where t.${f.col} is not null and not exists (select 1 from owners o where o.id = t.${f.col})`)).n;
check('still 0 orphaned references after re-import', orphans2 === 0, `${orphans2}`);
const stmtIds = await one(`select count(*) filter (where id ~ '\\d{6}-\\d{2}-\\d{4}')::int n from owner_statements`);
check('no statement or payout id carries an IC number', stmtIds.n === 0 && (await one(`select count(*) filter (where id ~ '\\d{6}-\\d{2}-\\d{4}')::int n from payouts`)).n === 0);
await wire.end();
await server.stop();

/* ---------- 4. stand-in production: 0052 (and any later migration) pending ---------- */
const prod = new PGlite();
await prod.exec(`create table public.pos_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now())`);
for (const f of migrations.filter(f => f < '0052')) {
  await prod.query(`insert into public.pos_migrations (filename, checksum) values ($1, $2)`, [f, createHash('sha256').update(body(f).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)]);
}
const PROD_PORT = PORT + 1;
const prodServer = new PGLiteSocketServer({ db: prod, port: PROD_PORT });
await prodServer.start();
const out = await new Promise(resolve => {
  const child = spawn(process.execPath, ['scripts/migrate-pg.mjs', '--prompt', '--dry-run'], { cwd: root, env: { ...process.env, DATABASE_URL: '' } });
  let text = '';
  child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
  child.stdin.end(`postgres://postgres:standin@127.0.0.1:${PROD_PORT}/postgres\n`);
  child.on('close', code => resolve({ code, text }));
});
await prodServer.stop();
console.log(`\nstand-in production, migrate-pg --prompt --dry-run (exit ${out.code}):\n${out.text.trim().split('\n').map(l => `   ${l}`).join('\n')}`);
const pending = [...out.text.matchAll(/^pending: (\S+)/gm)].map(m => m[1]);
// Exactly 0052 and whatever later migration this branch adds (0054 on feat/owner-statements): nothing before 0052.
const expected = migrations.filter(f => f >= m52);
check(`pending is exactly ${expected.join(', ')}`, out.code === 0 && JSON.stringify(pending) === JSON.stringify(expected), JSON.stringify(pending));
check('the connection string is not printed', !out.text.includes('standin'));

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
