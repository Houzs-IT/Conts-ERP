// Contract types kept on Units > Unit settings (migration 0206, PLAN-unit-settings.md): the contract-types API, a contract saved
// against a type, and the screens' fallback to the raw code for a type they do not know.
// Throwaway database only; it calls the handlers directly, so no dev server is needed:
//   1. PORT=55461 node scripts/dev-pglite.mjs            (leave it running; it applies every migration and seeds the demo users)
//   2. node scripts/api-checks/contract-types.mjs [postgres://pos_app:local@127.0.0.1:55461/postgres]
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
const entry = ['db:_lib/db.ts', 'types:api/contract-types/index.ts', 'type:api/contract-types/[code].ts', 'contract:api/units/[id]/contract.ts',
  'lib:_lib/contractTypes.ts', 'purpose:_lib/unitPurpose.ts', 'view:_lib/unitContract.ts',
].map(e => { const [name, path] = e.split(':'); return `export * as ${name} from './functions/${path}';`; }).join('\n')
  + "\nexport * as screens from './src/lib/revenueModel.ts';";
const out = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'contract-types-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

const env = { HYPERDRIVE: { connectionString: url }, SESSION_SECRET: process.env.SESSION_SECRET };
const { one, run } = M.db;
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
const addType = body => call(M.types, 'POST', '/api/contract-types', { body });
const patchType = (code, body, role) => call(M.type, 'PATCH', `/api/contract-types/${encodeURIComponent(code)}`, { params: { code }, body, role });
const listTypes = async () => (await call(M.types, 'GET', '/api/contract-types')).json?.data ?? [];

/* ---------- the pure pieces: an unknown or hidden code never crashes a row ---------- */
{
  const hidden = { code: 'OLD', label: 'Old type', package: null, revenueModel: 'long_term', blurb: null, isDefaultForModel: false, sortOrder: 99, isActive: false };
  const types = [...M.lib.BUILT_IN_CONTRACT_TYPES, hidden];
  check('server: a stored code that is not a type reads as its model\'s default', M.purpose.codeOf(types, 'management', 'NO SUCH TYPE') === 'PS');
  check('server: a hidden type is still read as itself', M.purpose.codeOf(types, 'long_term', 'OLD') === 'OLD');
  check('server: GRR is no longer a type', !types.some(t => t.code === 'GRR'));
  {
  const v = M.view.contractView({ id: 'c', revenue_model: 'management', contract_code: 'NO SUCH TYPE', management_fee_pct: 25 }, { package: 'Package A' }, 25, 0, types);
  check('server: a contract row with an unknown code builds a view, read as the default type of its model', v.contractCode === 'PS');
}
  check('screens: the label of an unknown code is the code', M.screens.codeLabel(types, 'NO SUCH TYPE') === 'NO SUCH TYPE');
  check('screens: the name of an unknown code is the code', M.screens.codeName(types, 'NO SUCH TYPE') === 'NO SUCH TYPE');
  check('screens: an unknown code has no package', M.screens.packageOf(types, 'NO SUCH TYPE') === null);
  check('screens: a type with no package has none (RTR)', M.screens.packageOf(types, 'RTR') === null && M.screens.codeName(types, 'RTR') === 'RTR');
  check('screens: PS reads "PS (Package A)"', M.screens.codeName(types, 'PS') === 'PS (Package A)');
  check('screens: a hidden type is not offered, its own unit still gets it', !M.screens.offeredTypes(types).some(t => t.code === 'OLD') && M.screens.offeredTypes(types, 'OLD').some(t => t.code === 'OLD'));
}

/* ---------- the list ---------- */
let r = await call(M.types, 'GET', '/api/contract-types');
check('list: the six seeded types, no GRR', r.status === 200 && r.json?.ready === true && r.json.data.length >= 6 && !r.json.data.some(t => t.code === 'GRR'), r.text);
check('list: any desk role can read it', (await call(M.types, 'GET', '/api/contract-types', { role: 'operations_staff' })).status === 200);

/* ---------- adding a type ---------- */
const CODE = `TC ${tag.toUpperCase()}`.slice(0, 20);
r = await addType({ code: CODE, label: 'Check type', revenueModel: 'bogus' });
check('add: an unknown income model is refused', r.status === 422 && !!r.json?.error?.fields?.revenueModel, r.text);
r = await addType({ code: CODE.toLowerCase(), label: 'Check type', revenueModel: 'management' });
check('add: a lower case code is refused', r.status === 422 && !!r.json?.error?.fields?.code, r.text);
r = await addType({ code: 'X'.repeat(21), label: 'Check type', revenueModel: 'management' });
check('add: a code over 20 characters is refused', r.status === 422 && !!r.json?.error?.fields?.code, r.text);
r = await addType({ code: CODE, label: '  ', revenueModel: 'management' });
check('add: an empty name is refused', r.status === 422 && !!r.json?.error?.fields?.label, r.text);
r = await call(M.types, 'POST', '/api/contract-types', { body: { code: CODE, label: 'Check type', revenueModel: 'management' }, role: 'operations_staff' });
check('add: only managers may', r.status === 403, r.text);
r = await addType({ code: CODE, label: 'Check type', package: 'Package Z', revenueModel: 'management', blurb: 'For the check' });
check('add: a good type', r.status === 201 && r.json?.code === CODE, r.text);
r = await addType({ code: CODE, label: 'Again', revenueModel: 'management' });
check('add: the same code twice is refused', r.status === 409, r.text);
const added = (await listTypes()).find(t => t.code === CODE);
check('add: it is listed last, active, with its package, and is not a default', !!added && added.isActive && added.package === 'Package Z' && !added.isDefaultForModel && added.contracts === 0, JSON.stringify(added));

/* ---------- changing a type ---------- */
r = await patchType(CODE, { code: 'OTHER' });
check('change: the code cannot change', r.status === 422 && !!r.json?.error?.fields?.code, r.text);
r = await patchType(CODE, { revenueModel: 'bogus' });
check('change: an unknown income model is refused', r.status === 422 && !!r.json?.error?.fields?.revenueModel, r.text);
r = await patchType('NO SUCH TYPE', { label: 'x' });
check('change: a type that is not on the list is 404', r.status === 404, r.text);
r = await patchType(CODE, { label: 'Renamed', package: '', isActive: true });
check('change: rename and clear the package', r.status === 200, r.text);
check('change: it reads back renamed with no package', (await listTypes()).find(t => t.code === CODE)?.package === null);
r = await patchType(CODE, { revenueModel: 'long_term' });
check('change: the income model moves while no contract uses the type', r.status === 200, r.text);
r = await patchType(CODE, { revenueModel: 'management' });
check('change: and back', r.status === 200, r.text);

/* ---------- options ---------- */
{
  const seeded = Object.fromEntries((await listTypes()).map(t => [t.code, t]));
  check('options: MANAGE has the fixed owner amount, RTR the rent-out grid, LT no operator share, PS the agent share',
    seeded.MANAGE?.hasFixedOwnerAmount && seeded.RTR?.hasRentOutGrid && seeded.LT?.hasNoOperatorShare && seeded.PS?.hasAgentShare && !seeded.PS?.hasFixedOwnerAmount, JSON.stringify(seeded.PS));
  const models = ['management', 'management_guarantee', 'management_yearly_guarantee', 'master_lease', 'long_term'];
  check('options: the screens offer each option for the same income models as the server',
    M.screens.CONTRACT_TYPE_OPTIONS.every(o => models.every(m => o.fits(m) === M.lib.OPTION_FITS[o.key](m))) && M.screens.CONTRACT_TYPE_OPTIONS.length === M.lib.CONTRACT_TYPE_OPTION_KEYS.length);
  check('options: the built-in lists agree', JSON.stringify(M.screens.BUILT_IN_CONTRACT_TYPES) === JSON.stringify(M.lib.BUILT_IN_CONTRACT_TYPES));
  const OWN = `${CODE} M`.slice(0, 20);
  r = await addType({ code: OWN, label: 'Check manage', revenueModel: 'long_term', hasFixedOwnerAmount: true });
  check('options: one that does not fit the income model is refused', r.status === 422 && !!r.json?.error?.fields?.hasFixedOwnerAmount, r.text);
  r = await addType({ code: OWN, label: 'Check manage', revenueModel: 'management', hasFixedOwnerAmount: true, hasAgentShare: false });
  const own = (await listTypes()).find(t => t.code === OWN);
  check('options: a new type keeps the options ticked', r.status === 201 && own?.hasFixedOwnerAmount === true && own.hasAgentShare === false, JSON.stringify(own));
  check('options: a new type with none sent takes its model\'s plain terms', added.hasAgentShare === true && added.hasFixedOwnerAmount === false);
  r = await patchType(OWN, { hasAgentShare: true });
  check('options: they change while no contract uses the type', r.status === 200 && (await listTypes()).find(t => t.code === OWN)?.hasAgentShare === true, r.text);
  r = await patchType(OWN, { revenueModel: 'long_term' });
  const moved = (await listTypes()).find(t => t.code === OWN);
  check('options: a new income model takes its own plain options', r.status === 200 && moved?.hasNoOperatorShare === true && !moved.hasFixedOwnerAmount && !moved.hasAgentShare, JSON.stringify(moved));
  await patchType(OWN, { revenueModel: 'management', hasFixedOwnerAmount: true });
}

/* ---------- one default per income model ---------- */
check('add: guaranteed rent is refused', (await addType({ code: `${CODE} R`.slice(0, 20), label: 'Check', revenueModel: 'grr' })).status === 422);
const before = (await listTypes()).find(t => t.revenueModel === 'long_term' && t.isDefaultForModel);
r = await addType({ code: `${CODE} G`.slice(0, 20), label: 'Check long term', revenueModel: 'long_term', isDefaultForModel: true });
check('default: a new default is accepted', r.status === 201, r.text);
let lt = (await listTypes()).filter(t => t.revenueModel === 'long_term' && t.isDefaultForModel);
check('default: exactly one type is the default of its model, and it is the new one', lt.length === 1 && lt[0].code === `${CODE} G`.slice(0, 20), JSON.stringify(lt.map(t => t.code)));
r = await patchType(`${CODE} G`.slice(0, 20), { isDefaultForModel: false });
check('default: it cannot simply be switched off', r.status === 409, r.text);
if (before) await patchType(before.code, { isDefaultForModel: true });
lt = (await listTypes()).filter(t => t.revenueModel === 'long_term' && t.isDefaultForModel);
check('default: handing it back leaves exactly one again', lt.length === 1 && lt[0].code === before?.code, JSON.stringify(lt.map(t => t.code)));

/* ---------- a contract saved against a type ---------- */
const ownerId = `t-own-${tag}`, propId = `t-prop-${tag}`, unitId = `t-unit-${tag}`, unit2 = `t-unit2-${tag}`;
await run(env, 'INSERT INTO owners (id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ownerId, `Owner ${tag}`, `${ownerId}@example.com`, now, now);
await run(env, 'INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', propId, `Tower ${tag}`, 'Jalan 1', 'KL', 'WP', now, now);
for (const [id, n] of [[unitId, 'C-01'], [unit2, 'C-02']]) await run(env, 'INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)', id, propId, ownerId, n, now, now);
const draft = (code, revenueModel = 'management') => ({ revenueModel, contractCode: code, ownerPct: 75, managementPct: 25, agentPct: 0, startsOn: '2026-01-01', endsOn: '2026-12-31', mode: 'update' });
const saveContract = (id, body) => call(M.contract, 'PUT', `/api/units/${id}/contract`, { params: { id }, body });

r = await saveContract(unitId, draft('NO SUCH TYPE'));
check('contract: a code that is not a type is refused', r.status === 422 && !!r.json?.error?.fields?.contractCode, r.text);
r = await saveContract(unitId, { ...draft(CODE, 'long_term'), monthlyRent: 250000, tenantName: 'Tenant' });
check('contract: a type with another income model is refused', r.status === 422 && !!r.json?.error?.fields?.contractCode, r.text);
r = await saveContract(unitId, draft(CODE));
check('contract: an active type is accepted', r.status === 200, r.text);
r = await call(M.contract, 'GET', `/api/units/${unitId}/contract`, { params: { id: unitId } });
check('contract: it reads back with the type\'s code and offers the active types', r.status === 200 && r.json?.current?.contractCode === CODE && r.json.allowedCodes.includes(CODE) && !r.json.allowedCodes.includes('GRR'), r.text);
r = await patchType(CODE, { revenueModel: 'long_term' });
check('contract: the income model of a type in use cannot change', r.status === 409 && !!r.json?.error?.fields?.revenueModel, r.text);
check('contract: the list counts the contract', (await listTypes()).find(t => t.code === CODE)?.contracts === 1);
r = await patchType(CODE, { hasAgentShare: false });
check('contract: the options of a type in use cannot change', r.status === 409 && !!r.json?.error?.fields?.hasAgentShare, r.text);
{
  const OWN = `${CODE} M`.slice(0, 20), unit3 = `t-unit3-${tag}`;
  await run(env, 'INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)', unit3, propId, ownerId, 'C-03', now, now);
  r = await saveContract(unit3, { ...draft(OWN), ownerPct: 80, managementPct: 20 });
  check('contract: a type with a fixed owner amount needs the amount', r.status === 422 && !!r.json?.error?.fields?.ownerAmount, r.text);
  r = await saveContract(unit3, { ...draft(OWN), ownerPct: 80, managementPct: 20, ownerAmount: 150000 });
  const saved = (await call(M.contract, 'GET', `/api/units/${unit3}/contract`, { params: { id: unit3 } })).json?.current;
  check('contract: and reads it back, like MANAGE', r.status === 200 && saved?.contractCode === OWN && saved.ownerAmount === 150000, JSON.stringify(saved));
}

await patchType(CODE, { isActive: false });
r = await call(M.contract, 'GET', `/api/units/${unitId}/contract`, { params: { id: unitId } });
check('hidden: the unit that has it is still offered it', r.json?.allowedCodes.includes(CODE), r.text);
r = await saveContract(unitId, draft(CODE));
check('hidden: that unit can save a contract on it', r.status === 200, r.text);
r = await call(M.contract, 'GET', `/api/units/${unit2}/contract`, { params: { id: unit2 } });
check('hidden: another unit is not offered it', r.status === 200 && !r.json.allowedCodes.includes(CODE), r.text);
r = await saveContract(unit2, draft(CODE));
check('hidden: a new contract on a hidden type is refused', r.status === 422 && !!r.json?.error?.fields?.contractCode, r.text);
await patchType(CODE, { isActive: true });
r = await saveContract(unit2, draft(CODE));
check('hidden: shown again, it is accepted', r.status === 200, r.text);

r = await call(M.contract, 'PUT', `/api/units/${unit2}/contract`, { params: { id: unit2 }, body: { ...draft(undefined), contractCode: undefined } });
check('contract: a request with only a model takes that model\'s default type', r.status === 200, r.text);

done();
