// HostPlatform + owner-workbook import, end to end, on an in-memory Postgres (PGlite) built from migrations-pg.
// Runs the same mapping and SQL the API runs, over the real export files, TWICE, and prints counts only
// (never a guest, owner or bank detail).
//
// Run: node scripts/api-checks/hostplatform-import.mjs <folder with listing.csv, res-*.csv, airbnb-orders.xlsx> [--map-only]
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
const sheet = name => wb ? M.pick(M.sheetObjects(wb.sheets[name] ?? [], M.WORKBOOK_HEADER_ROW[name] ?? 1, name), M.WORKBOOK_COLUMNS[name]) : [];
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

let WU, WA, WC, WE;
if (wb) {
  WU = M.mapWorkbookUnits(W.units, W.splits, W.pool);
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
  console.log(`workbook expenses -> ${WE.expenses.length} expenses ${JSON.stringify(count(WE.expenses, e => e.category))} totalling ${rm(WE.expenses.reduce((n, e) => n + e.amount, 0))}; ${WE.skipped.length} skipped (negative credits ${rm(-WE.skipped.reduce((n, s) => n + (Number(/RM (-?[\d.]+)/.exec(s.reason)?.[1] ?? 0) * 100), 0))}), ${WE.errors.length} refused`);
  const payout = wb.sheets['OWNER PAYOUT'];
  if (payout === undefined) console.log('   OWNER PAYOUT: not read (by design).');
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
const db = {
  all: async (sql, ...args) => (await pg.query(numbered(sql), args)).rows,
  run: async (sql, ...args) => { await pg.query(numbered(sql), args); },
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
  if (wb) await step('workbook units', [await M.importWorkbookUnits(db, M.mapWorkbookUnits(W.units, W.splits, W.pool).units, now)]);
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
    for (const c of chunks([...W.water, ...W.electricity, ...W.internet, ...W.sewerage, ...W.misc], 200)) { const m = M.mapWorkbookExpenses(c); const x = await M.importExpenses(db, m.expenses, now); x.skipped += m.skipped.length + m.errors.length; er.push(x); }
    await step('workbook expenses', er);
  }
  const tables = ['properties', 'owners', 'owner_contracts', 'units', 'unit_expenses', 'guests', 'reservations', 'tasks', 'expenses'];
  const counts = {};
  for (const t of tables) counts[t] = Number((await pg.query(`select count(*)::int as n from ${t}`)).rows[0].n);
  console.log('  table counts:', JSON.stringify(counts));
  return { tally, counts };
}

const first = await runAll('run 1');
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
const audit = Number((await q(`select count(*)::int n from audit_log`))[0].n);
console.log(`  audit_log rows: ${audit} (the API writes one per request; this script calls the library directly)`);
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
