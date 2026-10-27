// The HostPlatform API pull's write rules (importReservations with source 'api'), on an in-memory Postgres (PGlite)
// built from migrations-pg, with made-up bookings. Needs no HostPlatform access and no data files.
// Run: node scripts/api-checks/hostplatform-api-pull.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = await build({
  stdin: { contents: `export * from './functions/_lib/hostplatformImport.ts'; export * from './functions/_lib/hostplatformImportDb.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'hp-api-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

let fails = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

const { PGlite } = await import('@electric-sql/pglite');
const pg = new PGlite();
await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'pos_app') then create role pos_app login; end if; end $$;`);
for (const f of readdirSync(join(root, 'migrations-pg')).filter(f => f.endsWith('.sql')).sort()) {
  try { await pg.exec(`begin;\n${readFileSync(join(root, 'migrations-pg', f), 'utf8')}\ncommit;`); } catch { await pg.exec('rollback;').catch(() => {}); }
}
await pg.exec('set search_path = pos');
const t = '2026-08-01T00:00:00.000Z';
await pg.exec(`
  insert into owners (id, display_name, email, created_at, updated_at) values ('o1', 'Owner', '', '${t}', '${t}');
  insert into properties (id, name, address_line, city, state, created_at, updated_at) values ('p-agile', 'Agile', 'x', 'Kuala Lumpur', 'WP', '${t}', '${t}'), ('p-trion', 'Trion KL', 'x', 'Kuala Lumpur', 'WP', '${t}', '${t}');
  insert into units (id, property_id, owner_id, unit_number, base_rate, is_listed, created_at, updated_at) values
    ('u1', 'p-agile', 'o1', 'C13-13A', 0, 1, '${t}', '${t}'), ('u2', 'p-trion', 'o1', 'B56-06 (A)', 0, 1, '${t}', '${t}');
  insert into guests (id, full_name, created_at) values ('g-kept', 'Guest with documents', '${t}');
  insert into reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, currency, notes, created_at, updated_at) values
    ('hp-res-KEEP00001', 'u1', 'g-kept', 'owner_stay', 'KEEP00001', 'confirmed', '2026-10-20', '2026-10-22', 2, 50000, 0, 41000, 'MYR', 'Imported from HostPlatform (KEEP00001) · amounts from owner workbook', '${t}', '${t}'),
    ('hp-res-CANC00001', 'u1', null, 'airbnb', 'HMCANC', 'confirmed', '2026-11-01', '2026-11-03', 1, 30000, 5000, 0, 'MYR', 'Imported from HostPlatform (CANC00001)', '${t}', '${t}'),
    ('hp-res-BACK00001', 'u1', null, 'airbnb', 'HMBACK', 'cancelled', '2026-11-05', '2026-11-06', 1, 30000, 5000, 0, 'MYR', 'Imported from HostPlatform (BACK00001)', '${t}', '${t}'),
    ('11111111-1111-1111-1111-111111111111', 'u1', null, 'direct', null, 'confirmed', '2026-12-01', '2026-12-04', 1, 20000, 0, 0, 'MYR', 'Typed in Property OS', '${t}', '${t}');`);

const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const { default: postgres } = await import('postgres');
const PORT = Number(process.env.API_PULL_PORT ?? 55434);
const server = new PGLiteSocketServer({ db: pg, port: PORT });
await server.start();
const wire = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, {
  max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' },
  types: { number: { to: 20, from: [20, 1700], serialize: x => String(x), parse: x => Number(x) } },
});
const numbered = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const db = { all: async (sql, ...args) => wire.unsafe(numbered(sql), args), run: async (sql, ...args) => { await wire.unsafe(numbered(sql), args); } };

const g = { number_of_pax: 3, first_name: 'New', last_name: 'Name', contact_no: '0123', email: 'n@x.com' };
const row = (code, extra) => ({ code, status: 'Confirmed', source: 'airbnb', unit: 'C13-13A 2B1B', unit_id: 'i65p5u1', property: 'Agile The Conts', property_id: 'i65p5',
  guest_details: g, price_details: { currency: 'MYR', room: 100, platform_fee: 20 }, ...extra });
const api = [
  row('KEEP00001', { source: 'hostplatform', check_in_date: '2026-10-20', check_out_date: '2026-10-23' }), // checkout moved, guest count changed
  row('CANC00001', { source_id: 'HMCANC', status: 'Cancelled by OTA', check_in_date: '2026-11-01', check_out_date: '2026-11-03' }),
  row('BACK00001', { source_id: 'HMBACK', check_in_date: '2026-11-05', check_out_date: '2026-11-06' }),
  row('NEW000001', { source_id: 'HMNEW1', check_in_date: '2026-11-10', check_out_date: '2026-11-12' }),
  row('CLASH0001', { source_id: 'HMCLASH', check_in_date: '2026-12-02', check_out_date: '2026-12-03' }),
  row('BLOCK0001', { source: 'hostplatform', guest_details: undefined, price_details: undefined, unit: 'B56-06(A) 1B1B', property: 'Trion KL (2) The Conts', check_in_date: '2026-12-10', check_out_date: '2026-12-20' }),
  row('NOUNIT001', { unit: 'Z99-99 1B1B', check_in_date: '2026-11-10', check_out_date: '2026-11-11' }),
];
const now = '2026-10-27T03:00:00.000Z';
// Preview: the same import in a transaction that is rolled back (as functions/api/import/hostplatform-api.ts does).
const snapshotRows = async () => JSON.stringify(await db.all(`SELECT * FROM reservations ORDER BY id`)) + JSON.stringify(await db.all(`SELECT * FROM guests ORDER BY id`));
const before = await snapshotRows();
let previewed = null;
await wire.begin(async tx => {
  const txDb = { all: async (sql, ...args) => tx.unsafe(numbered(sql), args), run: async (sql, ...args) => { await tx.unsafe(numbered(sql), args); } };
  previewed = await M.importReservations(txDb, M.mapApiReservations(api, '2026-10-27'), now, { source: 'api' });
  throw new Error('roll back');
}).catch(e => { if (e.message !== 'roll back') throw e; });
check('preview: saves nothing', (await snapshotRows()) === before, true);

const first = await M.importReservations(db, M.mapApiReservations(api, '2026-10-27'), now, { source: 'api' });
check('preview: counts equal the real pull', [previewed.created, previewed.updated, previewed.skippedRows.length, previewed.effects], [first.created, first.updated, first.skippedRows.length, first.effects]);
const get = async id => (await db.all(`SELECT unit_id, guest_id, channel, state, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, notes FROM reservations WHERE id = ?`, id))[0];

check('first pull: 2 added (new booking and block), 3 updated', [first.created, first.updated], [2, 3]);
check('first pull: overlap with a Property OS booking left out', first.skippedRows.map(r => r.row), ['CLASH0001']);
check('first pull: unknown unit refused', first.errors.length, 1);
const keep = await get('hp-res-KEEP00001');
check('existing: dates and guest count follow HostPlatform', [keep.check_out, keep.guests_count], ['2026-10-23', 3]);
check('existing: money, channel, notes, guest and state untouched', [keep.gross_booking_value, keep.collected_revenue, keep.channel, keep.guest_id, keep.state, keep.notes.includes('owner workbook')], [50000, 41000, 'owner_stay', 'g-kept', 'confirmed', true]);
check('existing: cancellation applied, money kept', [(await get('hp-res-CANC00001')).state, (await get('hp-res-CANC00001')).gross_booking_value], ['cancelled', 30000]);
check('existing: cancelled here but live on HostPlatform is reinstated', (await get('hp-res-BACK00001')).state, 'confirmed');
const fresh = await get('hp-res-NEW000001');
check('new: full booking written', [fresh.channel, fresh.state, fresh.gross_booking_value, fresh.channel_fee, fresh.collected_revenue, !!fresh.guest_id], ['airbnb', 'confirmed', 12000, 2000, 0, true]);
check('new block on the merged Trion KL building', [(await get('hp-res-BLOCK0001'))?.unit_id, (await get('hp-res-BLOCK0001'))?.channel], ['u2', 'maintenance_block']);
check('effects for cleaning', [first.effects.cancelled, first.effects.checkoutMoved, first.effects.live.length], [['hp-res-CANC00001'], ['hp-res-KEEP00001'], 4]);
check('no guest made for an existing booking', (await db.all(`SELECT count(*)::int AS n FROM guests`))[0].n, 2);

const second = await M.importReservations(db, M.mapApiReservations(api, '2026-10-27'), now, { source: 'api' });
check('repeat pull: nothing added, nothing rewritten', [second.created, second.updated, second.effects.checkoutMoved.length, second.effects.cancelled.length], [0, 0, 0, 0]);
check('repeat pull: no new reservations', (await db.all(`SELECT count(*)::int AS n FROM reservations`))[0].n, 6);

await wire.end();
await server.stop();
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0);
