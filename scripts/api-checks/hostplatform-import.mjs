// HostPlatform + owner-workbook import, end to end, on an in-memory Postgres (PGlite) built from migrations-pg.
// Runs the same mapping and SQL the API runs, over the real export files, TWICE, and prints counts only
// (never a guest, owner or bank detail).
//
// Run: node scripts/api-checks/hostplatform-import.mjs <folder with listing.csv, res-*.csv, airbnb-orders.xlsx> [--map-only]
//      ... --serve        import once, then keep this database running on 127.0.0.1:55433 (or BIGDATA_PORT) as a local backend
//                         full of real-sized data: in another terminal,
//                         WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://postgres:local@127.0.0.1:55433/postgres npm run dev
//                         and sign in as dev@local.test with DEV_PASSWORD (default LocalTest1). Local only.
// The export files hold personal data: keep them outside the repository.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/api-checks/hostplatform-import.mjs <data folder> [--map-only]'); process.exit(2); }
const mapOnly = process.argv.includes('--map-only');
const serve = process.argv.includes('--serve');
const PORT = Number(process.env.BIGDATA_PORT ?? 55433);

// The Worker code imports without file extensions; bundle it once so Node can load it.
const out = await build({
  stdin: {
    contents: `export * from './functions/_lib/hostplatformImport.ts'; export * from './functions/_lib/hostplatformImportDb.ts'; export * from './src/lib/sheets.ts';`,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'hp-import-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const rm = n => `RM ${(n / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---------- read the files exactly as the browser does ---------- */
const files = readdirSync(dir);
const listing = M.pick(M.csvObjects(readFileSync(join(dir, 'listing.csv'), 'utf8')).rows, M.LISTING_COLUMNS);
const resFiles = files.filter(f => /^res.*\.csv$/i.test(f)).sort();
const reservations = resFiles.flatMap(f => M.pick(M.csvObjects(readFileSync(join(dir, f), 'utf8')).rows, M.RESERVATION_COLUMNS));
const xlsxName = files.find(f => /\.xlsx$/i.test(f));
const S = M.WORKBOOK_SHEETS;
const wb = xlsxName ? await M.readXlsx(readFileSync(join(dir, xlsxName)), Object.values(S)) : null;
const sheet = name => !wb ? [] : M.pick(name === S.pool ? M.poolSheetRows(wb.sheets[name] ?? []) : M.sheetObjects(wb.sheets[name] ?? [], M.WORKBOOK_HEADER_ROW[name] ?? 1, name), M.WORKBOOK_COLUMNS[name]);
const W = Object.fromEntries(Object.entries(S).map(([k, name]) => [k, sheet(name)]));
console.log(`files: listing ${listing.length} rows, reservations ${reservations.length} rows from ${resFiles.length} files, workbook ${xlsxName ? 'yes' : 'no'}`);
if (wb) console.log('workbook rows read:', Object.fromEntries(Object.entries(W).map(([k, v]) => [k, v.length])), '| login sheet read:', Object.keys(wb.sheets).includes('用户管理'));

/* ---------- mapping, no database ---------- */
const today = M.todayInKL();
const L = M.mapListing(listing);
const R = M.mapReservations(reservations, today);
console.log(`\nlisting -> ${L.properties.length} buildings, ${L.units.length} units, ${L.owners.length} owners, ${L.unitExpenses.length} monthly costs, ${L.errors.length} rows refused`);
for (const e of L.errors) console.log(`   refused row ${e.row}: ${e.reason}`);
console.log(`reservations -> ${R.reservations.length} bookings, ${R.guests.length} distinct guests, ${R.errors.length} rows refused`);
console.log('   by channel', count(R.reservations, r => r.channel));
console.log('   by state  ', count(R.reservations, r => r.state));
const ck = new Set(L.units.map(u => M.unitKey(u.building, u.unitNumber)));
const unmatched = R.reservations.filter(r => !ck.has(M.unitKey(r.building, r.unitNumber)));
console.log(`   bookings whose unit is not in the listing: ${unmatched.length}`);
const live = R.reservations.filter(r => r.state !== 'cancelled');
console.log(`   money (not cancelled): gross ${rm(live.reduce((n, r) => n + r.gross, 0))}, fees ${rm(live.reduce((n, r) => n + r.fee, 0))}, collected ${rm(live.reduce((n, r) => n + r.collected, 0))}`);
check('every listing row maps to a unit', L.units.length + L.errors.length === listing.length);
check('every booking code is unique', new Set(R.reservations.map(r => r.id)).size === R.reservations.length);
check('every booking has check-out after check-in', R.reservations.every(r => r.checkOut > r.checkIn));

let WU, WA, WC, WE, WP;
if (wb) {
  WU = M.mapWorkbookUnits(W.units, W.splits, W.pool, today);
  WA = M.mapAirbnbEarnings(W.airbnb);
  WC = M.mapCleaning(W.cleaning, W.cleaningPrices);
  WE = M.mapWorkbookExpenses([...W.water, ...W.electricity, ...W.internet, ...W.sewerage, ...W.misc]);
  console.log(`\nworkbook units -> ${WU.units.length} units (${WU.errors.length} refused); contracts ${WU.units.filter(u => u.contract).length}; split ${JSON.stringify(count(WU.units, u => u.split ?? 'none'))}`);
  for (const n of WU.notes) console.log('   note:', n);
  // Match rate against the HostPlatform units, before anything is written.
  const known = L.units.map(u => ({ id: u.id, unitNumber: u.unitNumber, propertyId: u.propertyId, propertyName: u.building }));
  const hits = new Set(); let matched = 0;
  for (const u of WU.units) { const h = M.matchWorkbookUnit(u.workbookId, known); if (h) { matched++; hits.add(h.id); } }
  console.log(`   match: ${matched} matched, ${WU.units.length - matched} workbook-only, ${known.length - hits.size} HostPlatform-only`);
  console.log(`   workbook-only prefixes: ${JSON.stringify(count(WU.units.filter(u => !M.matchWorkbookUnit(u.workbookId, known)), u => M.splitWorkbookId(u.workbookId).prefix))}`);
  console.log(`   HostPlatform-only buildings: ${JSON.stringify(count(L.units.filter(u => !hits.has(u.id)), u => u.building))}`);
  console.log(`workbook airbnb -> ${WA.earnings.length} lines, ${WA.skipped.length} skipped (${JSON.stringify(count(WA.skipped, s => s.reason.replace(/^[A-Z0-9]+.*?: /, '').slice(0, 40)))}), ${WA.errors.length} refused`);
  const hpRefs = new Set(R.reservations.map(r => r.externalRef));
  console.log(`   codes also on HostPlatform: ${WA.earnings.filter(e => hpRefs.has(e.code)).length} of ${WA.earnings.length}`);
  console.log(`workbook cleaning -> ${WC.cleanings.length} cleans ${JSON.stringify(count(WC.cleanings, c => c.kind))}, ${WC.skipped.length} skipped, ${WC.errors.length} refused, with a price & owner-paid: ${WC.cleanings.filter(c => c.price && !c.payer).length}`);
  console.log(`workbook expenses -> ${WE.expenses.length} expenses ${JSON.stringify(count(WE.expenses, e => e.category))} totalling ${rm(WE.expenses.reduce((n, e) => n + e.amount, 0))}; ${WE.credits.length} owner credits totalling ${rm(WE.credits.reduce((n, c) => n + c.amount, 0))}; ${WE.skipped.length} skipped, ${WE.errors.length} refused`);
  WP = M.mapPayoutHistory(W.payouts, W.report, today);
  console.log(`workbook payouts -> ${W.payouts.length} sheet rows, ${WP.months.length} unit-months before ${today.slice(0, 7)} ${JSON.stringify(count(WP.months, m => m.month))}, total ${rm(WP.months.reduce((n, m) => n + m.amount, 0))}; report month ${WP.reportMonth}, ${WP.months.filter(m => m.breakdown).length} with a breakdown`);
  for (const n of WP.notes) console.log('   note:', n);
  for (const x of WP.skipped) console.log('   skipped:', x.reason);
  check('workbook units: Package D mapped', WU.units.some(u => u.pkg === 'Package D'));
}
// Rough CPU cost of the JavaScript side of one 500-row request (mapping + unit matching + JSON), without the database.
{
  const t = (f) => { const a = performance.now(); for (let i = 0; i < 5; i++) f(); return ((performance.now() - a) / 5).toFixed(1); };
  const c = reservations.slice(0, 500);
  const known = L.units.map(u => ({ id: u.id, unitNumber: u.unitNumber, propertyId: u.propertyId, propertyName: u.building }));
  const msRes = t(() => JSON.stringify(M.mapReservations(JSON.parse(JSON.stringify(c)), today).reservations));
  const msAb = wb ? t(() => { const m = M.workbookMatcher(known); for (const e of M.mapAirbnbEarnings(W.airbnb.slice(0, 500)).earnings) m(e.workbookId); }) : '-';
  const msCl = wb ? t(() => { const m = M.workbookMatcher(known); for (const e of M.mapCleaning(W.cleaning.slice(0, 500), W.cleaningPrices).cleanings) m(e.workbookId); }) : '-';
  console.log(`
JS time per 500-row request on this machine (no database): reservations ${msRes} ms, airbnb lines ${msAb} ms, cleaning ${msCl} ms`);
}
if (mapOnly) { console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0); }

/* ---------- the real SQL on PGlite ---------- */
const { PGlite } = await import('@electric-sql/pglite');
const pg = new PGlite();
await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'pos_app') then create role pos_app login; end if; end $$;`);
const migrations = readdirSync(join(root, 'migrations-pg')).filter(f => f.endsWith('.sql')).sort();
const skipped = [];
for (const f of migrations) {
  try { await pg.exec(`begin;\n${readFileSync(join(root, 'migrations-pg', f), 'utf8')}\ncommit;`); }
  catch (e) { await pg.exec('rollback;').catch(() => {}); skipped.push(`${f} (${String(e.message).slice(0, 80)})`); }
}
console.log(`\nPGlite: applied ${migrations.length - skipped.length} of ${migrations.length} migrations${skipped.length ? `; skipped ${skipped.join('; ')}` : ''}`);
await pg.exec('set search_path = pos');
// Production already has one building and the Channex pilot unit; stand in for both so the merge rules run.
const now0 = new Date().toISOString();
await pg.exec(`
  insert into owners (id, display_name, email, created_at, updated_at) values ('pilot-owner', 'Pilot owner', '', '${now0}', '${now0}');
  insert into properties (id, name, address_line, city, state, created_at, updated_at) values ('pilot-prop', 'Regalia', 'Jalan Sultan Ismail', 'Kuala Lumpur', 'WP', '${now0}', '${now0}');`);
const regalia = L.units.find(u => u.building === 'Regalia');
if (regalia) {
  await pg.exec(`insert into units (id, property_id, owner_id, unit_number, base_rate, is_listed, channex_property_id, created_at, updated_at)
    values ('pilot-unit', 'pilot-prop', 'pilot-owner', '${regalia.unitNumber}', 12300, 1, 'chx-prop', '${now0}', '${now0}')`);
}

const numbered = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
// Queries go through postgres.js over the wire with functions/_lib/db.ts's options, not pg.query():
// PGlite's own client typed a bare ?::jsonb parameter differently from the production driver, so the
// first live import failed on a query this check had passed (8 Oct 2026).
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const { default: postgres } = await import('postgres');
const server = new PGLiteSocketServer({ db: pg, port: PORT });
await server.start();
const wire = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, {
  max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' },
  types: { number: { to: 20, from: [20, 1700], serialize: x => String(x), parse: x => Number(x) } },
});
const db = {
  all: async (sql, ...args) => wire.unsafe(numbered(sql), args),
  run: async (sql, ...args) => { await wire.unsafe(numbered(sql), args); },
};
const chunks = (xs, n) => { const o = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };

async function runAll(label) {
  const now = new Date().toISOString(), tally = {};
  const step = async (name, results) => {
    const r = { created: 0, updated: 0, skipped: 0, errors: 0, tables: {}, stats: {} };
    for (const x of results) {
      r.created += x.created; r.updated += x.updated; r.skipped += x.skipped; r.errors += x.errors.length;
      for (const [t, v] of Object.entries(x.tables)) { r.tables[t] ??= { created: 0, updated: 0 }; r.tables[t].created += v.created; r.tables[t].updated += v.updated; }
      for (const [k, v] of Object.entries(x.stats ?? {})) r.stats[k] = (r.stats[k] ?? 0) + v;
      for (const e of x.errors.slice(0, 3)) console.log(`     error row ${e.row}: ${e.reason}`);
    }
    tally[name] = r;
    console.log(`  ${name.padEnd(18)} created ${r.created}, updated ${r.updated}, skipped ${r.skipped} (errors ${r.errors}) ${JSON.stringify(r.tables)}${Object.keys(r.stats).length ? ' ' + JSON.stringify(r.stats) : ''}`);
  };
  console.log(`\n== ${label} ==`);
  // Same order and part sizes (200 rows) as the screen.
  await step('listing', [await M.importListing(db, M.mapListing(listing), now)]);
  if (wb) await step('workbook units', [await M.importWorkbookUnits(db, M.mapWorkbookUnits(W.units, W.splits, W.pool, today).units, now, today)]);
  const rr = [];
  for (const c of chunks(reservations, 200)) rr.push(await M.importReservations(db, M.mapReservations(c, today), now));
  await step('reservations', rr);
  if (wb) {
    const ar = [];
    for (const c of M.chunkByKey(W.airbnb, r => String(r['确认码'] ?? ''), 200)) { const m = M.mapAirbnbEarnings(c); const x = await M.importAirbnbEarnings(db, m.earnings, today, now); x.skipped += m.skipped.length + m.errors.length; ar.push(x); }
    await step('workbook airbnb', ar);
    const cr = [];
    for (const c of chunks(W.cleaning, 200)) { const m = M.mapCleaning(c, W.cleaningPrices); const x = await M.importCleaning(db, m.cleanings, today, now); x.skipped += m.skipped.length + m.errors.length; cr.push(x); }
    await step('workbook cleaning', cr);
    const er = [];
    for (const c of chunks([...W.water, ...W.electricity, ...W.internet, ...W.sewerage, ...W.misc], 200)) { const m = M.mapWorkbookExpenses(c); const x = await M.importExpenses(db, m.expenses, now, m.credits); x.skipped += m.skipped.length + m.errors.length; er.push(x); }
    await step('workbook expenses', er);
    // The whole OWNER PAYOUT sheet in one request, as the screen sends it.
    const pm = M.mapPayoutHistory(W.payouts, W.report, today);
    await step('workbook payouts', [await M.importPayoutHistory(db, pm.months, now)]);
  }
  const tables = ['properties', 'owners', 'owner_contracts', 'units', 'unit_expenses', 'guests', 'reservations', 'tasks', 'expenses',
    'cleaners', 'unit_utility_accounts', 'owner_adjustments', 'guarantee_pool_months', 'owner_statements', 'statement_lines', 'payouts'];
  const counts = {};
  for (const t of tables) counts[t] = Number((await pg.query(`select count(*)::int as n from ${t}`)).rows[0].n);
  console.log('  table counts:', JSON.stringify(counts));
  return { tally, counts };
}

const first = await runAll('run 1');
if (serve) {
  // The app's role has search_path = pos; the wire connection here is the superuser, so set it on the database.
  await pg.exec(`alter database postgres set search_path = pos, public`);
  // PGlite serves one wire connection at a time; free ours or the app's connections queue forever.
  await wire.end();
  const { webcrypto: wc } = await import('node:crypto');
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const salt = wc.getRandomValues(new Uint8Array(16));
  const key = await wc.subtle.importKey('raw', new TextEncoder().encode(process.env.DEV_PASSWORD ?? 'LocalTest1'), 'PBKDF2', false, ['deriveBits']);
  const bits = await wc.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const now = new Date().toISOString();
  await pg.query(`insert into users (id, email, full_name, password_hash, role, must_change_password, created_at, updated_at)
    values ('dev-admin', 'dev@local.test', 'Dev Admin', $1, 'management', 0, $2, $2) on conflict (id) do nothing`,
    [`pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`, now]);
  console.log(`\nserving on postgres://postgres@127.0.0.1:${PORT}/postgres  (sign in: dev@local.test). Ctrl+C to stop.`);
  await new Promise(() => {});
}
const second = await runAll('run 2 (same files again)');

const q = async sql => (await pg.query(sql)).rows;
console.log('\nchecks');
check('run 2 adds no rows to any table', JSON.stringify(first.counts) === JSON.stringify(second.counts), `${JSON.stringify(first.counts)} vs ${JSON.stringify(second.counts)}`);
check('run 2 creates nothing', Object.values(second.tally).every(s => s.created === 0), JSON.stringify(Object.fromEntries(Object.entries(second.tally).map(([k, v]) => [k, v.created]))));
const hpUnits = Number((await q(`select count(*)::int n from units where id like 'hp-unit-%' or id = 'pilot-unit'`))[0].n);
check(`listing units are all in (hp + pilot) = ${L.units.length}`, hpUnits === L.units.length, `${hpUnits}`);
const hpRes = Number((await q(`select count(*)::int n from reservations where id like 'hp-res-%' and id not like 'hp-res-ab-%' and id not like 'hp-res-bc-%'`))[0].n);
check(`HostPlatform bookings in = ${R.reservations.length}`, hpRes === R.reservations.length, `${hpRes}`);
const dupRefs = await q(`select external_ref, unit_id, count(*)::int n from reservations where state <> 'cancelled' group by 1, 2 having count(*) > 1`);
check('no booking reference twice on the same unit', dupRefs.length === 0, `${dupRefs.length} duplicates`);
const overlap = await q(`select w.channel, count(*)::int n, min(w.check_in) first_in, max(w.check_in) last_in from reservations w join reservations h
  on h.unit_id = w.unit_id and h.id like 'hp-res-%' and h.id !~ '^hp-res-(ab|bc)-' and h.state <> 'cancelled' and h.check_in < w.check_out and h.check_out > w.check_in
  where w.id ~ '^hp-res-(ab|bc)-' group by 1`);
console.log('  workbook-only bookings that overlap a HostPlatform booking on the same unit:', JSON.stringify(overlap));
const wbOnlyRange = await q(`select channel, count(*)::int n, min(check_in) first_in, max(check_in) last_in from reservations where id ~ '^hp-res-(ab|bc)-' group by 1`);
console.log('  workbook-only bookings:', JSON.stringify(wbOnlyRange));
const pilot = (await q(`select channex_property_id, is_listed, owner_id, base_rate from units where id = 'pilot-unit'`))[0];
if (pilot) check('pilot unit keeps its Channex mapping, listing flag and price', pilot.channex_property_id === 'chx-prop' && pilot.is_listed === 1 && pilot.base_rate === 12300, JSON.stringify(pilot));
const reg = await q(`select count(*)::int n from properties where lower(name) = 'regalia'`);
check('Regalia is not duplicated', reg[0].n === 1);
const money = (await q(`select channel, count(*)::int n, sum(gross_booking_value)::bigint gross, sum(channel_fee)::bigint fee, sum(collected_revenue)::bigint collected
  from reservations where state <> 'cancelled' group by channel order by channel`));
console.log('  bookings (not cancelled) by channel:'); for (const m of money) console.log(`    ${m.channel.padEnd(18)} ${String(m.n).padStart(5)}  gross ${rm(Number(m.gross))}  fees ${rm(Number(m.fee))}  collected ${rm(Number(m.collected))}`);
const states = await q(`select state, count(*)::int n from reservations group by 1 order by 1`);
console.log('  by state:', JSON.stringify(Object.fromEntries(states.map(s => [s.state, s.n]))));
const wbMoney = Number((await q(`select count(*)::int n from reservations where notes like '%amounts from owner workbook%'`))[0].n);
console.log(`  bookings whose money comes from the owner workbook: ${wbMoney}`);
const neg = Number((await q(`select count(*)::int n from reservations where gross_booking_value < 0 or channel_fee < 0 or collected_revenue < 0 or channel_fee > gross_booking_value`))[0].n);
check('no negative money, and no fee bigger than the booking', neg === 0, `${neg} rows`);
const owners = await q(`select count(*)::int n, count(*) filter (where id = 'hp-owner-to-be-confirmed')::int placeholder from owners`);
const onPlaceholder = Number((await q(`select count(*)::int n from units where owner_id = 'hp-owner-to-be-confirmed'`))[0].n);
console.log(`  owners ${owners[0].n}; units still under "Owner to be confirmed": ${onPlaceholder}`);
const expByCat = await q(`select category, count(*)::int n, sum(amount)::bigint total from expenses group by 1 order by 1`);
console.log('  expenses:', expByCat.map(e => `${e.category} ${e.n} (${rm(Number(e.total))})`).join(', '));

if (wb) {
  console.log('\nworkbook completeness');
  const one = async sql => (await q(sql))[0];
  const pkgD = await one(`select count(*)::int n from units where package = 'Package D'`);
  const wantD = WU.units.filter(u => u.packageD).length;
  console.log(`  Package D: ${pkgD.n} units in Property OS, ${wantD} workbook unit ids`);
  check('Package D units imported', pkgD.n > 0 && pkgD.n <= wantD, `${pkgD.n} of ${wantD}`);
  const con = await one(`select count(*)::int n, count(*) filter (where agent_fee_pct > 0)::int agent, count(*) filter (where minimum_guarantee > 0)::int minimum,
    count(*) filter (where agreement_file is not null)::int file, count(*) filter (where misc_charges = 1)::int misc,
    count(*) filter (where model = 'management' and grr_amount <> 0)::int mgmt_grr from owner_contracts`);
  console.log(`  contracts ${con.n}: agent share ${con.agent}, monthly minimum ${con.minimum}, agreement file ${con.file}, misc charges ${con.misc}`);
  check('management contracts carry no fixed rent (the minimum moved to minimum_guarantee)', con.mgmt_grr === 0, `${con.mgmt_grr}`);
  const ua = await q(`select kind, count(*)::int n from unit_utility_accounts group by 1 order by 1`);
  const uaTotal = ua.reduce((n, r) => n + r.n, 0), uaWant = WU.units.reduce((n, u) => n + u.utilityAccounts.length, 0);
  console.log(`  utility accounts ${uaTotal} (workbook rows give ${uaWant}): ${ua.map(r => `${r.kind} ${r.n}`).join(', ')}`);
  check('utility accounts imported (one per unit and kind)', uaTotal > 0 && uaTotal <= uaWant, `${uaTotal} of ${uaWant}`);
  const pool = await one(`select count(*)::int n, count(distinct unit_id)::int units, max(month) last from guarantee_pool_months`);
  console.log(`  guarantee pool months ${pool.n} on ${pool.units} units, last ${pool.last}`);
  check('no pool month for this month or later', !pool.last || pool.last < today.slice(0, 7), pool.last);
  const credits = await one(`select count(*)::int n, coalesce(sum(amount), 0)::bigint total, count(*) filter (where state = 'settled')::int settled,
    coalesce(sum(amount) filter (where state = 'settled'), 0)::bigint settled_total,
    count(*) filter (where state = 'settled' and statement_id is not null)::int on_stmt, count(*) filter (where state = 'open')::int open,
    coalesce(sum(amount) filter (where state = 'open'), 0)::bigint open_total from owner_adjustments where kind in ('credit','charge') and source = 'owner_workbook'`);
  const wantCredits = WE.credits.reduce((n, c) => n + c.amount, 0);
  console.log(`  owner adjustments (credits and charges) ${credits.n} = ${rm(Number(credits.total))}; settled in workbook payouts ${credits.settled} = ${rm(Number(credits.settled_total))} (${credits.on_stmt} linked to that month's statement); open for the next statement ${credits.open} = ${rm(Number(credits.open_total))}`);
  const inDb = new Set((await q(`select id from owner_adjustments where kind in ('credit','charge')`)).map(r => r.id));
  const refused = WE.credits.filter(c => !inDb.has(c.id));
  console.log(`  adjustments in the workbook ${WE.credits.length} = ${rm(wantCredits)}; refused ${refused.length} = ${rm(refused.reduce((n, c) => n + c.amount, 0))} on ${[...new Set(refused.map(c => c.workbookId))].join(', ') || 'none'} (no named owner)`);
  check(`owner adjustments: imported + refused = ${WE.credits.length} lines, ${rm(wantCredits)} net to owners`, Number(credits.total) + refused.reduce((n, c) => n + c.amount, 0) === wantCredits && credits.n + refused.length === WE.credits.length, `${credits.n} imported, ${refused.length} refused`);
  const debt = await one(`select count(*)::int n, coalesce(sum(amount), 0)::bigint total, count(*) filter (where state = 'held')::int held from owner_adjustments where kind = 'opening_debt'`);
  console.log(`  debts carried over ${debt.n} = ${rm(-Number(debt.total))}, held ${debt.held}`);
  check('every DEBT AMOUNT recorded and held', debt.n === WU.units.filter(u => u.debt).length && debt.held === debt.n, `${debt.n}`);
  const cl = await one(`select count(*)::int n, count(*) filter (where employment_type = 'outsourced')::int outsourced from cleaners where id like 'wb-cleaner-%'`);
  const linked = await one(`select count(*)::int n from tasks where id like 'wb-clean-%' and cleaner_id is not null`);
  const wantCl = new Set(WC.cleanings.map(c => c.cleaner).filter(Boolean)).size;
  console.log(`  cleaners ${cl.n} (outsourced ${cl.outsourced}); cleaning tasks linked to a cleaner ${linked.n} of ${WC.cleanings.filter(c => c.cleaner).length} named in the sheet`);
  check(`cleaner roster has every name in 负责人 (${wantCl})`, cl.n === wantCl, `${cl.n}`);
  const st = await one(`select count(*)::int n, count(distinct owner_id)::int owners, min(period_start) first, max(period_start) last, coalesce(sum(net_payout), 0)::bigint net,
    count(*) filter (where state <> 'paid')::int not_paid from owner_statements where source = 'owner_workbook'`);
  const lines = await one(`select count(distinct (unit_id, statement_id))::int unit_months from statement_lines where statement_id like 'wb-stmt-%'`);
  const po = await one(`select count(*)::int n, coalesce(sum(amount), 0)::bigint total from payouts where source = 'owner_workbook'`);
  const wantNet = WP.months.reduce((n, m) => n + m.amount, 0);
  console.log(`  history statements ${st.n} for ${st.owners} owners, ${st.first} to ${st.last}, net ${rm(Number(st.net))}; paid payouts ${po.n} = ${rm(Number(po.total))}`);
  console.log(`  history unit-months: mapped ${WP.months.length}, on statements ${lines.unit_months}; net mapped ${rm(wantNet)}`);
  check('history statements are all paid', st.not_paid === 0);
  check(`no statement for this month or later (${today.slice(0, 7)})`, !st.last || st.last < `${today.slice(0, 7)}-01`, st.last);
  check('statement totals add up (net = gross - fee - expenses + adjustments)', (await one(`select count(*)::int n from owner_statements where net_payout <> gross_booking_value - management_fee - expenses_total + adjustments_total`)).n === 0);
  check('history statement lines add up to each statement net', (await one(`select count(*)::int n from owner_statements s where s.source = 'owner_workbook' and s.net_payout <> (select coalesce(sum(amount), 0) from statement_lines l where l.statement_id = s.id)`)).n === 0);
  const money = await one(`select count(*) filter (where room_revenue is not null)::int room, count(*) filter (where guest_cleaning_fee > 0)::int cleaning, count(*) filter (where sst_amount > 0)::int sst,
    count(*) filter (where ota_tax > 0)::int ota_tax, count(*) filter (where payout_amount is not null)::int payout, count(*) filter (where payment_method is not null)::int method,
    count(*) filter (where rate_plan is not null)::int rate_plan, count(*) filter (where guest_nationality is not null)::int nationality, count(*) filter (where payout_date is not null)::int payout_date from reservations`);
  console.log(`  booking money columns filled: ${JSON.stringify(money)}`);
  check('HostPlatform bookings have room revenue', money.room === R.reservations.length, `${money.room} of ${R.reservations.length}`);
  const hpSum = (await one(`select count(*)::int n from reservations where id like 'hp-res-%' and id !~ '^hp-res-(ab|bc)-' and notes not like '%amounts from owner workbook%'
    and room_revenue + coalesce(guest_cleaning_fee, 0) + coalesce(sst_amount, 0) + coalesce(extra_fees, 0) + coalesce(tourism_tax, 0) <> gross_booking_value - case when channel = 'airbnb' then channel_fee else 0 end`)).n;
  check('HostPlatform money parts add up to the booking total (room + cleaning + SST + extras + tourism tax)', hpSum === 0, `${hpSum} bookings differ`);
}

{
  console.log('\nbuilding state and city');
  const dist = async () => (await q(`select count(distinct trim(state))::int states, count(distinct trim(city))::int cities,
    json_agg(distinct trim(state)) state_list, json_agg(distinct trim(city)) city_list from properties`))[0];
  const imported = await dist();
  console.log(`  as this import writes them: ${imported.states} states ${JSON.stringify(imported.state_list)}, ${imported.cities} cities ${JSON.stringify(imported.city_list)}`);
  const ownStates = (await q(`select distinct state from properties where id like 'hp-%' or id like 'wb-%'`)).map(r => r.state);
  check('the import writes only canonical state names on its own buildings (a hand-made one is left to the fix step)', ownStates.every(s => M.MY_STATES.includes(s)), JSON.stringify(ownStates));
  // Put back what the first production import wrote (listing text as exported, blank on workbook-made buildings, 'WP' typed by hand), then run the fix.
  const raw = new Map(listing.map(r => [M.buildingName(r['Property Name']).toLowerCase(), r]));
  const props = await q(`select id, name from properties`);
  for (const p of props) {
    const r = raw.get(p.name.toLowerCase());
    const state = p.id === 'pilot-prop' ? 'WP' : r ? String(r['State'] ?? '') : '';
    const city = p.id === 'pilot-prop' ? 'Kuala Lumpur' : r ? String(r['city'] ?? '') : '';
    await pg.query(`update properties set state = $1, city = $2, postcode = case when id like 'wb-%' then null else postcode end where id = $3`, [state, city, p.id]);
  }
  const before = await dist();
  console.log(`  before the fix (as production has them now): ${before.states} states ${JSON.stringify(before.state_list)}, ${before.cities} cities ${JSON.stringify(before.city_list)}`);
  const f1 = await M.fixLocations(db, new Date().toISOString());
  const after = await dist();
  console.log(`  fix run 1: ${f1.updated} buildings changed ${JSON.stringify(f1.stats)}; ${f1.skippedRows.length} left without a state`);
  console.log(`  after the fix: ${after.states} states ${JSON.stringify(after.state_list)}, ${after.cities} cities ${JSON.stringify(after.city_list)}`);
  const f2 = await M.fixLocations(db, new Date().toISOString());
  check('fix: every building has a canonical state', after.state_list.every(s => M.MY_STATES.includes(s)), JSON.stringify(after.state_list));
  check('fix run 2 changes nothing', f2.updated === 0, `${f2.updated}`);
  await pg.query(`update properties set state = 'Somewhere Else' where id = 'pilot-prop'`);
  const f3 = await M.fixLocations(db, new Date().toISOString());
  const kept = (await q(`select state from properties where id = 'pilot-prop'`))[0].state;
  check('fix leaves a state it does not recognise as typed', kept === 'Somewhere Else' && f3.updated === 0, `${kept}, ${f3.updated} changed`);
}
const audit = Number((await q(`select count(*)::int n from audit_log`))[0].n);
console.log(`  audit_log rows: ${audit} (the API writes one per request; this script calls the library directly)`);
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
