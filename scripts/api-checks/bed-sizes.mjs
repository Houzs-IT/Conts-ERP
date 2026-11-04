// Bed sizes kept on Units > Unit settings (migration 0210, owner 4 Nov 2026): the unit-bed-sizes API, and a unit's beds
// checked against the list (a hidden size stays on the unit that has it).
// Throwaway database only; it calls the handlers directly, so no dev server is needed:
//   1. PORT=55461 node scripts/dev-pglite.mjs            (leave it running; it applies every migration and seeds the demo users)
//   2. node scripts/api-checks/bed-sizes.mjs [postgres://pos_app:local@127.0.0.1:55461/postgres]
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const url = process.argv[2] ?? 'postgres://pos_app:local@127.0.0.1:55461/postgres';
if (!/@(127\.0\.0\.1|localhost):/.test(url)) { console.error('Refused: local database only.'); process.exit(2); }
process.env.SESSION_SECRET ??= 'smoke-test-secret-not-real-0123456789';
const { cookieFor, check, done } = await import('./harness.mjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = ['db:_lib/db.ts', 'sizes:api/unit-bed-sizes/index.ts', 'types:api/unit-layout-types/index.ts', 'size:api/unit-bed-sizes/[key].ts', 'unit:api/units/[id].ts', 'purpose:_lib/unitPurpose.ts',
].map(e => { const [name, path] = e.split(':'); return `export * as ${name} from './functions/${path}';`; }).join('\n');
const out = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'bed-sizes-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

const env = { HYPERDRIVE: { connectionString: url }, SESSION_SECRET: process.env.SESSION_SECRET };
const { run } = M.db;
const tag = Date.now().toString(36);
const now = new Date().toISOString();

/** One handler call as a signed-in role: { status, json, text }. */
async function call(mod, method, path, { params = {}, body, role = 'management' } = {}) {
  const request = new Request('http://local.test' + path, { method, headers: { cookie: cookieFor(role), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const handler = mod[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  const res = await handler({ request, env, params, data: {}, waitUntil() {}, next() {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const addSize = (body, role) => call(M.sizes, 'POST', '/api/unit-bed-sizes', { body, role });
const patchSize = (key, body, role) => call(M.size, 'PATCH', `/api/unit-bed-sizes/${key}`, { params: { key }, body, role });
const saveBeds = (id, beds) => call(M.unit, 'PATCH', `/api/units/${id}`, { params: { id }, body: { beds } });

/* ---------- the pure pieces ---------- */
check('label: names come from the list, an unknown key reads as itself',
  M.purpose.bedsLabel([{ size: 'queen', quantity: 2 }, { size: 'gone', quantity: 1 }], [{ key: 'queen', label: 'Queen' }]) === '2 Queen · 1 gone');
check('shape: a size that is not text is refused', M.purpose.invalidBeds([{ size: 3, quantity: 1 }]) !== null);
check('shape: the same size twice is refused', M.purpose.invalidBeds([{ size: 'queen', quantity: 1 }, { size: 'queen', quantity: 1 }]) !== null);

/* ---------- the list ---------- */
let r = await call(M.sizes, 'GET', '/api/unit-bed-sizes');
check('list: the seven seeded sizes', r.status === 200 && r.json?.ready === true && ['king', 'queen', 'double_decker'].every(k => r.json.data.some(s => s.key === k)), r.text);
for (const role of ['operations_manager', 'operations_staff', 'housekeeper']) {
  const [bed, type] = [await call(M.sizes, 'GET', '/api/unit-bed-sizes', { role }), await call(M.types, 'GET', '/api/unit-layout-types', { role })];
  check(`list: ${role} reads it exactly when they read the Type list`, bed.status === type.status, `${bed.status} vs ${type.status}`);
}

/* ---------- adding, renaming, hiding ---------- */
const LABEL = `Double ${tag}`, KEY = `double_${tag}`;
check('add: only managers may', (await addSize({ label: LABEL }, 'operations_staff')).status === 403);
check('add: an empty name is refused', (await addSize({ label: '  ' })).status === 422);
r = await addSize({ label: LABEL });
check('add: a new size gets a key from its name', r.status === 201 && r.json?.key === KEY, r.text);
check('add: the same name again is refused', (await addSize({ label: LABEL.toUpperCase() })).status === 409);
check('rename: another size\'s name is refused', (await patchSize(KEY, { label: 'Queen' })).status === 409);
check('rename: a new name is kept', (await patchSize(KEY, { label: `${LABEL} bed` })).status === 200);

/* ---------- a unit's beds checked against the list ---------- */
const ownerId = `t-own-${tag}`, propId = `t-prop-${tag}`, unitId = `t-unit-${tag}`, unit2 = `t-unit2-${tag}`;
await run(env, 'INSERT INTO owners (id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ownerId, `Owner ${tag}`, `${ownerId}@example.com`, now, now);
await run(env, 'INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', propId, `Tower ${tag}`, 'Jalan 1', 'KL', 'WP', now, now);
for (const [id, n] of [[unitId, 'B-01'], [unit2, 'B-02']]) await run(env, 'INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)', id, propId, ownerId, n, now, now);

r = await saveBeds(unitId, [{ size: 'no_such_size', quantity: 1 }]);
check('unit: a size not on the list is refused', r.status === 422 && !!r.json?.error?.fields?.beds, r.text);
r = await saveBeds(unitId, [{ size: KEY, quantity: 2 }, { size: 'queen', quantity: 1 }]);
check('unit: a size staff added is accepted', r.status === 200, r.text);

await patchSize(KEY, { isActive: false });
r = await saveBeds(unitId, [{ size: KEY, quantity: 3 }]);
check('hidden: the unit that has it can keep it', r.status === 200, r.text);
r = await saveBeds(unit2, [{ size: KEY, quantity: 1 }]);
check('hidden: another unit cannot take it', r.status === 422 && !!r.json?.error?.fields?.beds, r.text);
await patchSize(KEY, { isActive: true });
check('hidden: shown again, it is accepted', (await saveBeds(unit2, [{ size: KEY, quantity: 1 }])).status === 200);

done();
