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

const letter = s => s === 401 ? 'U' : s === 403 ? 'F' : s >= 500 ? 'E' : 'A';

/* ---------- run ---------- */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain) {
  const { ownerB } = await setup();
  const ids = await sampleIds(ownerB);
  const expected = existsSync(EXPECTED) ? JSON.parse(readFileSync(EXPECTED, 'utf8')) : {};
  const actual = {}; const detail = {};
  const list = routes().filter(r => !ONLY || r.route.slice(1).startsWith(ONLY.replace(/^\//, '')));
  const started = Date.now();
  for (const r of list) {
    for (const method of r.methods) {
      const write = method !== 'GET';
      const path = pathFor(r.route, ids, write);
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
