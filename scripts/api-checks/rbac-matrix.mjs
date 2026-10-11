// Role x endpoint matrix: calls EVERY handler under functions/api, every method it exports, as every role
// (the six staff roles, an owner portal account, and nobody signed in), and compares who got through with
// the reviewed table in rbac-matrix.expected.json. A handler that is not in the table fails the run, so a new
// endpoint cannot ship without someone deciding who may call it.
//
// Run: 1. BIGDATA_PORT=55446 node scripts/api-checks/hostplatform-import.mjs <data folder> --serve   (leave it running)
//      2. a local server on that database (SESSION_SECRET in .dev.vars), e.g. on :8806
//      3. BIGDATA_PORT=55446 BASE=http://localhost:8806 node scripts/api-checks/rbac-matrix.mjs [--record] [--only=<prefix>]
// --record rewrites rbac-matrix.expected.json from what the server answered (review the diff before committing it).
//
// Reads use real ids (a real owner's statement, unit, booking, guest), so a read that is let through returns real data.
// Writes are sent with an empty body and, on routes with an id, an id that does not exist: a role that is let through
// gets a validation error or "not found", a role that is not gets 403, and nothing real is changed.
// It adds one test account per role (rbac.<role>@local.test) and links two owners to owner accounts; run it on a
// local database only.
//
// Letters: A = reached the handler (2xx, 4xx other than 401/403), F = 403 refused, U = 401 signed out, E = 5xx.
// Column order: management, operations_manager, operations_staff, finance_admin, housekeeper, technician, owner, signed out.
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPECTED = join(ROOT, 'scripts', 'api-checks', 'rbac-matrix.expected.json');
const PORT = Number(process.env.BIGDATA_PORT ?? 55446);
const BASE = process.env.BASE ?? 'http://localhost:8806';
const SECRET = process.env.SESSION_SECRET
  ?? (existsSync(join(ROOT, '.dev.vars')) ? /SESSION_SECRET\s*=\s*"?([^"\n]+)"?/.exec(readFileSync(join(ROOT, '.dev.vars'), 'utf8'))?.[1] : undefined);
if (!SECRET) { console.error('Set SESSION_SECRET (or add it to .dev.vars).'); process.exit(2); }
const RECORD = process.argv.includes('--record');
const ONLY = process.argv.find(a => a.startsWith('--only='))?.slice(7);

// PGlite serves one wire connection at a time: open and close one per query so the server's own query never waits.
export const db = async (text, ...values) => {
  const c = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

let fails = 0;
export const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${String(more).slice(0, 300)}`}`); };

const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookieOf = u => {
  const body = Buffer.from(JSON.stringify({ userId: u.id, email: u.email, role: u.role, fullName: u.name, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`;
};
export async function call(u, method, path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    const r = await fetch(BASE + path, {
      method, redirect: 'manual', signal: ctl.signal,
      headers: { ...(u ? { cookie: cookieOf(u) } : {}), 'content-type': 'application/json' },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t };
  } catch (e) {
    return { status: 599, json: null, text: String(e) };
  } finally { clearTimeout(timer); }
}

/* ---------- accounts: one per role, two owners linked to owner accounts ---------- */
export const PERSONAS = ['management', 'operations_manager', 'operations_staff', 'finance_admin', 'housekeeper', 'technician', 'owner', 'anon'];
const uid = n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const USERS = Object.fromEntries(PERSONAS.slice(0, 6).map((role, i) => [role, { id: uid(i + 1), role, email: `rbac.${role}@local.test`, name: `RBAC ${role}` }]));
USERS.owner = { id: uid(7), role: 'owner', email: 'rbac.owner-a@local.test', name: 'RBAC owner A' };
USERS.ownerB = { id: uid(8), role: 'owner', email: 'rbac.owner-b@local.test', name: 'RBAC owner B' };
USERS.anon = null;

export async function setup() {
  for (const u of Object.values(USERS).filter(Boolean)) {
    await db(`INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, locale, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, 'pbkdf2$100000$00$00', $4, 0, 'en-MY', 1, now(), now())
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, is_active = 1, full_name = EXCLUDED.full_name`, u.id, u.email, u.name, u.role);
  }
  // Two owners who each have statements an owner may see, so one can ask for the other's.
  const owners = await db(`SELECT o.id FROM owners o JOIN owner_statements s ON s.owner_id = o.id
    WHERE s.state IN ('finalised','sent','paid') AND (o.user_id IS NULL OR o.user_id IN ($1, $2))
    GROUP BY o.id ORDER BY o.id LIMIT 2`, USERS.owner.id, USERS.ownerB.id);
  if (owners.length < 2) throw new Error('Need two owners with final statements on this database.');
  await db('UPDATE owners SET user_id = NULL WHERE user_id IN ($1, $2)', USERS.owner.id, USERS.ownerB.id);
  await db('UPDATE owners SET user_id = $1 WHERE id = $2', USERS.owner.id, owners[0].id);
  await db('UPDATE owners SET user_id = $1 WHERE id = $2', USERS.ownerB.id, owners[1].id);
  // Built-in levels only: a level chosen on the Permissions chart would change the answers.
  const chosen = await db('SELECT count(*)::int AS n FROM role_access').catch(() => [{ n: 0 }]);
  if (chosen[0].n) throw new Error('role_access has chosen levels; the matrix is for the built-in rules. Clear them on a local database first.');
  return { ownerA: owners[0].id, ownerB: owners[1].id };
}

/** Real ids for reads: everything of owner B's, so owner A's calls show whether another owner's records leak. */
export async function sampleIds(ownerB) {
  const one = async (sql, ...v) => (await db(sql, ...v).catch(() => []))[0]?.id ?? FAKE;
  const unit = await one('SELECT id FROM units WHERE owner_id = $1 ORDER BY id LIMIT 1', ownerB);
  return {
    owners: ownerB,
    units: unit,
    statements: await one(`SELECT id FROM owner_statements WHERE owner_id = $1 AND state IN ('finalised','sent','paid') ORDER BY period_start DESC LIMIT 1`, ownerB),
    reservations: await one('SELECT id FROM reservations WHERE unit_id = $1 ORDER BY check_in DESC LIMIT 1', unit),
    guests: await one('SELECT guest_id AS id FROM reservations WHERE unit_id = $1 AND guest_id IS NOT NULL LIMIT 1', unit),
    tasks: await one('SELECT id FROM tasks ORDER BY id LIMIT 1'),
    properties: await one('SELECT property_id AS id FROM units WHERE id = $1', unit),
    users: USERS.housekeeper.id,
  };
}
export const FAKE = '00000000-0000-4000-8000-00000000dead';

/* ---------- every handler file -> route + methods ---------- */
export function routes() {
  const out = [];
  const visit = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { visit(rel); continue; }
      if (!e.name.endsWith('.ts') || e.name === '_middleware.ts') continue;
      const text = readFileSync(join(ROOT, rel), 'utf8');
      const methods = [...text.matchAll(/export\s+(?:const|async\s+function|function)\s+onRequest(\w*)/g)].map(m => (m[1] || 'Get').toUpperCase());
      if (!methods.length) continue;
      const route = rel.replace(/^functions/, '').replace(/\.ts$/, '').replace(/\/index$/, '');
      out.push({ file: rel, route, methods: [...new Set(methods)] });
    }
  };
  visit('functions/api');
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** The concrete path for a read (real ids) or a write (a fake id, nothing real changes). */
function pathFor(route, ids, write) {
  const segs = route.split('/');
  return segs.map((s, i) => {
    if (s === '[[path]]') return '';
    const m = /^\[(\w+)\]$/.exec(s);
    if (!m) return s;
    if (write) return FAKE;
    if (segs[i - 1] === 'statements') return ids.statements;
    if (segs[i - 1] === 'owners') return ids.owners;
    if (segs[i - 1] === 'units') return ids.units;
    if (segs[i - 1] === 'reservations') return ids.reservations;
    if (segs[i - 1] === 'guests') return ids.guests;
    if (segs[i - 1] === 'tasks') return ids.tasks;
    if (segs[i - 1] === 'properties') return ids.properties;
    if (segs[i - 1] === 'users') return ids.users;
    return FAKE;
  }).join('/').replace(/\/+$/, '');
}

/** Reads that take their record from the query string: given owner B's record, like the screens send. */
const QUERY = {
  '/api/statements/pdf': ids => `?id=${ids.statements}`,
  '/api/units/detail': ids => `?unitId=${ids.units}`,
  '/api/units/stays': ids => `?unitId=${ids.units}`,
  '/api/search': () => '?q=a',
  '/api/audit': ids => `?entityTable=units&entityId=${ids.units}`,
};

/* ---------- scenarios the matrix cannot show: whose record, which fields, what changes mid-session ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function scenarios(ownerA, ownerB, ids) {
  const M = USERS.management, A = USERS.owner, B = USERS.ownerB, S = USERS.operations_staff, H = USERS.housekeeper;
  let r;
  // Another owner's records (IDOR by id, and the ?ownerId= that finance uses).
  r = await call(B, 'GET', `/api/owner/statements/${ids.statements}`);
  check('owner B opens their own statement', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
  for (const p of [`/api/owner/statements/${ids.statements}`, `/api/owner/statements/${ids.statements}/pdf`, `/api/statements/${ids.statements}/report`, `/api/statements/pdf?id=${ids.statements}`]) {
    r = await call(A, 'GET', p);
    check(`owner A cannot open owner B's ${p.replace(ids.statements, ':id')}`, r.status === 403 || r.status === 404, `${r.status} ${r.text.slice(0, 120)}`);
  }
  const mine = (await call(A, 'GET', '/api/owner/summary')).text;
  r = await call(A, 'GET', `/api/owner/summary?ownerId=${ownerB}`);
  check('owner A asking for ?ownerId=<B> still gets only their own summary', r.status === 200 && r.text.replace(/"generatedAt":"[^"]+"/, '') === mine.replace(/"generatedAt":"[^"]+"/, ''), r.text.slice(0, 160));

  // A file shared with owner B: B passes the scope check, A and a housekeeper do not; nothing says it exists.
  const docId = 'aaaaaaaa-0000-4000-8000-0000000d0c01';
  await db(`INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, owner_id, visible_to_owner, created_at)
    VALUES ($1, 'contract', 'rbac-test.pdf', 'application/pdf', 1, 'documents/rbac-test', $2, 1, now()) ON CONFLICT (id) DO NOTHING`, docId, ownerB);
  r = await call(B, 'GET', `/api/documents/${docId}/download`);
  check('owner B reaches their shared file (only storage may be missing locally)', r.status !== 403 && !/no longer exists/.test(r.text), `${r.status} ${r.text.slice(0, 120)}`);
  for (const [who, u] of [['owner A', A], ['a housekeeper', H], ['operations staff (no Owners access)', S]]) {
    r = await call(u, 'GET', `/api/documents/${docId}/download`);
    check(`${who} cannot download owner B's contract, and is told it does not exist`, r.status === 404 && /no longer exists/.test(r.text), `${r.status} ${r.text.slice(0, 120)}`);
  }
  await db('DELETE FROM documents WHERE id = $1', docId);

  // Sensitive fields: only finance-side roles see bank details, and never the full number in a list.
  r = await call(USERS.finance_admin, 'GET', '/api/owners');
  check('owner list never carries a full IC or bank number', r.status === 200 && r.json.data.every(o => o.ic == null && o.bankAccount == null), r.text.slice(0, 160));
  r = await call(S, 'GET', '/api/properties');
  const leaked = JSON.stringify(r.json ?? {}).match(/"(ic|bankAccount)":"[^"•]+"/);
  check('operations staff get no IC or bank number in the property list', r.status === 200 && !leaked, leaked?.[0] ?? `${r.status}`);

  // Field accounts: deny-by-default, but their own app works.
  for (const p of ['/api/search?q=a', '/api/units', '/api/portfolio/performance', '/api/dashboard/kpis', '/api/integrations', '/api/owners']) {
    r = await call(H, 'GET', p);
    check(`a housekeeper is refused ${p}`, r.status === 403, `${r.status}`);
  }
  r = await call(H, 'GET', '/api/field/tasks');
  check('a housekeeper still loads the field app', r.status === 200, `${r.status}`);

  // Nobody can raise their own role or level.
  r = await call(USERS.operations_manager, 'PATCH', `/api/users/${USERS.operations_manager.id}`, { role: 'management' });
  check('an operations manager cannot make themselves management', r.status === 403, `${r.status}`);
  r = await call(USERS.operations_manager, 'PUT', '/api/users/access', { changes: [{ role: 'operations_manager', area: 'users', level: 'full' }] });
  check('an operations manager cannot change the permissions chart', r.status === 403, `${r.status}`);
  r = await call(USERS.finance_admin, 'POST', '/api/users', { email: 'rbac.x@local.test', fullName: 'X', role: 'management' });
  check('finance cannot invite a management account', r.status === 403, `${r.status}`);
  r = await call(USERS.operations_manager, 'POST', '/api/auth/view-as', { userId: M.id });
  check('view as is off on this server (local, as on production)', r.status !== 200, `${r.status}`);

  // A change on Users and roles reaches a signed-in person on their next request.
  await db('UPDATE users SET is_active = 0 WHERE id = $1', H.id);
  r = await call(H, 'GET', '/api/field/tasks');
  check('a switched-off housekeeper is signed out at once (401)', r.status === 401, `${r.status}`);
  await db('UPDATE users SET is_active = 1 WHERE id = $1', H.id);
  await db(`UPDATE users SET role = 'housekeeper' WHERE id = $1`, S.id);
  r = await call(S, 'GET', '/api/reservations');
  check('operations staff turned housekeeper lose the desk on the next request', r.status === 403, `${r.status}`);
  await db(`UPDATE users SET role = 'operations_staff' WHERE id = $1`, S.id);

  // "No access" chosen on the chart refuses reads in that area everywhere, exports and search included,
  // while the shared unit list keeps the other screens working.
  r = await call(M, 'PUT', '/api/users/access', { changes: [{ role: 'operations_staff', area: 'reservations', level: 'none' }] });
  check('management sets operations staff to No access on Reservations', r.status === 200, r.text.slice(0, 160));
  await sleep(11_000);
  for (const p of ['/api/reservations', `/api/reservations/${ids.reservations}`, '/api/reservations/export', '/api/reservations/calendar', '/api/guests', `/api/guests/${ids.guests}`, '/api/guest-documents']) {
    r = await call(S, 'GET', p);
    check(`No access on Reservations refuses ${p.replace(/\/[0-9a-z-]{20,}$/, '/:id')}`, r.status === 403, `${r.status}`);
  }
  r = await call(S, 'GET', '/api/search?q=a');
  check('No access on Reservations: search finds no bookings or guests', r.status === 200 && !r.json.some(h => h.kind === 'reservation' || h.kind === 'guest'), r.text.slice(0, 160));
  r = await call(S, 'GET', '/api/units');
  check('No access on Reservations: the shared unit list still answers', r.status === 200, `${r.status}`);
  await call(M, 'PUT', '/api/users/access', { changes: [{ role: 'operations_staff', area: 'reservations', level: null }] });
  await sleep(11_000);
  r = await call(S, 'GET', '/api/reservations');
  check('putting the level back restores reading', r.status === 200, `${r.status}`);
}

const letter = s => s === 401 ? 'U' : s === 403 ? 'F' : s >= 500 ? 'E' : 'A';

/* ---------- run ---------- */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain) {
  const { ownerA, ownerB } = await setup();
  const ids = await sampleIds(ownerB);
  const expected = existsSync(EXPECTED) ? JSON.parse(readFileSync(EXPECTED, 'utf8')) : {};
  const actual = {}; const detail = {};
  const list = routes().filter(r => !ONLY || r.route.slice(1).startsWith(ONLY.replace(/^\//, '')));
  const started = Date.now();
  for (const r of list) {
    for (const method of r.methods) {
      const write = method !== 'GET';
      const path = pathFor(r.route, ids, write) + (write ? '' : QUERY[r.route]?.(ids) ?? '');
      const key = `${method} ${r.route}`;
      let row = '';
      for (const p of PERSONAS) {
        const res = await call(USERS[p], method, path, write ? {} : undefined);
        row += letter(res.status);
        detail[`${key} ${p}`] = `${res.status} ${res.text.slice(0, 140).replace(/\s+/g, ' ')}`;
      }
      actual[key] = row;
      const want = expected[key];
      if (RECORD) console.log(`${row}  ${key}`);
      else if (!want) check(`${key} is in rbac-matrix.expected.json`, false, `new route: decide who may call it (got ${row})`);
      else if (want !== row) {
        const diffs = PERSONAS.filter((_, i) => want[i] !== row[i]).map(p => `${p} expected ${want[PERSONAS.indexOf(p)]} got ${detail[`${key} ${p}`]}`);
        check(`${key} ${want}`, false, diffs.join(' | '));
      } else check(`${key} ${want}`, true);
    }
  }
  if (!ONLY && !RECORD) await scenarios(ownerA, ownerB, ids);
  if (!ONLY) for (const k of Object.keys(expected)) if (!(k in actual)) check(`${k} still exists`, false, 'route removed: drop it from rbac-matrix.expected.json');
  if (RECORD) {
    const merged = ONLY ? { ...expected, ...actual } : actual;
    writeFileSync(EXPECTED, JSON.stringify(Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
    writeFileSync(join(ROOT, '..', 'rbac-matrix-detail.json'), JSON.stringify(detail, null, 1));
    console.log(`recorded ${Object.keys(actual).length} route-methods in ${Math.round((Date.now() - started) / 1000)}s`);
  }
  console.log(fails ? `\n${fails} FAILED` : `\nall ok (${Object.keys(actual).length} route-methods x ${PERSONAS.length} roles)`);
  process.exit(fails ? 1 : 0);
}
