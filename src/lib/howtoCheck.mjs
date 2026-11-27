// Shared honesty checks for the AI Connector's help data (functions/_lib/howto/*): every page path must exist in the
// router, every double-quoted UI label must appear verbatim in the frontend, every permission must name a real API
// handler or permission area, every error fragment must still be in the code. Used by mcpHowto.test.mjs and the
// screen map / screenshot tests.
//
// Frontend = src/ (The Conts' own screens) + engine/frontend/src (the supply chain engine's screens shown inside the
// ERP: Dream Crafter's projects, sales and procurement, and Mail Center). Test files are left out of the corpus.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function walk(dir, out, filter) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist') continue;
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out, filter);
    else if (filter(f)) out.push(p);
  }
  return out;
}
const SOURCE = (f) => /\.(tsx?|mjs|js|json)$/.test(f) && !/\.test\.|\.spec\./.test(f);
/** The help data itself never counts as proof of a label (it would match itself). */
const isHelpData = (p) => relative(ROOT, p).split(sep).join('/').match(/^functions\/_lib\/(howto\/|mcpHowto|mcpScreens|mcpShowMe|mcpHelpShots)/);

const cache = new Map();
function corpus(key, dirs) {
  if (cache.has(key)) return cache.get(key);
  const files = dirs.flatMap(d => (/\.\w+$/.test(d) ? [join(ROOT, d)] : walk(join(ROOT, d), [], SOURCE))).filter(p => !isHelpData(p));
  const raw = files.map(p => readFileSync(p, 'utf8')).join('\n');
  // JSX wraps text across lines: also keep a whitespace-collapsed copy; and one with JS string escapes undone.
  const c = { raw, flat: raw.replace(/\s+/g, ' '), unescaped: raw.replace(/\\'/g, "'").replace(/\\"/g, '"') };
  cache.set(key, c);
  return c;
}
/** src/ + the engine's screens + the server files whose labels the screens show verbatim (the reservation drawer's
 *  status moves come from bookingLifecycle.ts movesFor). */
const FRONTEND = ['src', 'engine/frontend/src', 'functions/_lib/bookingLifecycle.ts'];
const BACKEND = ['functions', 'engine/backend/src'];

function has(c, s) {
  const l = s.replace(/\s+/g, ' ').trim();
  return c.raw.includes(s) || c.flat.includes(l) || c.unescaped.includes(s);
}
/** A label shown on screen: in The Conts' frontend or the engine's. */
export const labelExists = (label) => has(corpus('fe', FRONTEND), label);
/** An error message: in a handler (functions/, the engine's backend) or a screen. */
export const messageExists = (m) => has(corpus('be', [...BACKEND, ...FRONTEND]), m);

/** Double-quoted segments in a sentence. */
export const quotedLabels = (s) => [...String(s ?? '').matchAll(/"([^"]+)"/g)].map(m => m[1]);

let routes = null;
/** Every router path: src/App.tsx <Route path="..."> plus the supply chain menu addresses (scmEngine.ts ENGINE_PATH). */
export function routerPaths() {
  if (routes) return routes;
  const out = new Set();
  const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
  // An optional last segment ("/system/settings/:section?") counts with and without it.
  for (const m of app.matchAll(/<Route path="([^"]+)"/g)) if (m[1] !== '*') { out.add(m[1].replace(/\/:[^/]+\?$/, '')); out.add(m[1].replace(/\?$/, '')); }
  const eng = readFileSync(join(ROOT, 'src/lib/scmEngine.ts'), 'utf8');
  const block = eng.slice(eng.indexOf('export const ENGINE_PATH'));
  for (const m of block.slice(0, block.indexOf('};')).matchAll(/^\s*'([^']+)':/gm)) out.add(m[1]);
  for (const m of eng.matchAll(/slug: '([^']+)'/g)) { out.add(`/finance/${m[1]}`); out.add(`/supply/finance/${m[1]}`); }
  routes = out;
  return out;
}

const norm = (p) => p.split('?')[0].replace(/:[^/]+/g, ':x').replace(/\/$/, '') || '/';
export function pathExists(p) {
  const n = norm(p);
  for (const r of routerPaths()) if (norm(r) === n) return true;
  return false;
}

let api = null;
/** functions/api handlers: [{ re, methods }] from the file tree (index, [id], [[path]]). */
function apiHandlers() {
  if (api) return api;
  const base = join(ROOT, 'functions', 'api');
  api = walk(base, [], f => /\.ts$/.test(f)).map(p => {
    const rel = relative(base, p).split(sep).join('/').replace(/\.ts$/, '').replace(/\/?index$/, '');
    const re = new RegExp(`^/api${rel ? '/' : ''}${rel.split('/').map(s => (/^\[\[.+\]\]$/.test(s) ? '.*' : /^\[.+\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
    const t = readFileSync(p, 'utf8');
    const methods = new Set([...t.matchAll(/export (?:const|async function|function) onRequest(Get|Post|Put|Patch|Delete)?\b/g)].map(m => (m[1] ?? 'ANY').toUpperCase()));
    return { re, methods, rootCatchAll: /^\[\[.+\]\]$/.test(rel) };
  }).filter(h => !h.rootCatchAll); // the root [[path]] answers 404 for any unknown address

  return api;
}
/** "METHOD /api/path": a handler file for that path exports that method (or onRequest). */
export function apiHandlerExists(method, path) {
  return apiHandlers().some(h => h.re.test(path) && (h.methods.has(method) || h.methods.has('ANY')));
}

let areas = null;
export function areaKeys() {
  if (areas) return areas;
  const t = readFileSync(join(ROOT, 'functions/_lib/access.ts'), 'utf8');
  areas = new Set([...t.matchAll(/\{ key: '([A-Za-z]+)', label:/g)].map(m => m[1]));
  return areas;
}

export function permissionProblem(p) {
  const a = /^area:([A-Za-z]+):(view|edit|full)$/.exec(p);
  if (a) return areaKeys().has(a[1]) ? null : `unknown permission area ${a[1]}`;
  const m = /^(GET|POST|PUT|PATCH|DELETE) (\/api\/\S+)$/.exec(p);
  if (!m) return `permission "${p}" is neither "METHOD /api/path" nor "area:<key>:<level>"`;
  return apiHandlerExists(m[1], m[2]) ? null : `no ${m[1]} handler for ${m[2]}`;
}

/** All labels a guide claims are on screen. */
export function guideLabels(g) {
  const out = [];
  for (const s of g.steps ?? []) {
    out.push(...quotedLabels(s.do), ...quotedLabels(s.check), ...quotedLabels(s.then));
    if (s.highlight) out.push(s.highlight);
    for (const f of s.fields ?? []) out.push(f.label, ...quotedLabels(f.value));
  }
  for (const t of [...(g.checkBefore ?? []), ...(g.warnings ?? []), g.result, g.undo, g.approvals, g.deadlines]) out.push(...quotedLabels(t));
  for (const m of g.commonMistakes ?? []) out.push(...quotedLabels(m.mistake), ...quotedLabels(m.fix));
  for (const v of g.variants ?? []) for (const d of v.differences ?? []) out.push(...quotedLabels(d));
  for (const p of g.prerequisites ?? []) out.push(...quotedLabels(p));
  return out;
}

/** Problems in a list of guides: [{id, problem}]. */
export function checkGuides(guides) {
  const bad = [];
  for (const g of guides) {
    if (!pathExists(g.page)) bad.push({ id: g.id, problem: `page ${g.page} not in router` });
    for (const s of g.steps ?? []) if (s.page && !pathExists(s.page)) bad.push({ id: g.id, problem: `step page ${s.page} not in router` });
    for (const l of guideLabels(g)) if (!labelExists(l)) bad.push({ id: g.id, problem: `label "${l}" not found in the frontend` });
    for (const p of [...(g.permission ?? []), ...(g.permissionAny ?? [])]) { const why = permissionProblem(p); if (why) bad.push({ id: g.id, problem: why }); }
    if (!g.steps?.length) bad.push({ id: g.id, problem: 'no steps' });
    for (const k of ['purpose', 'who', 'sidebar', 'result', 'undo', 'workedExample', 'contact']) if (!String(g[k] ?? '').trim()) bad.push({ id: g.id, problem: `missing ${k}` });
    if (!(g.permission?.length || g.permissionAny?.length)) bad.push({ id: g.id, problem: 'missing permission / permissionAny' });
    for (const k of ['prerequisites', 'checkBefore', 'commonMistakes', 'keywords', 'companies', 'warnings']) if (!Array.isArray(g[k]) || !g[k].length) bad.push({ id: g.id, problem: `missing ${k}` });
    for (const s of g.steps ?? []) if (/fill in (the|all) (details|fields)|enter the details|as needed/i.test(s.do)) bad.push({ id: g.id, problem: `vague step: ${s.do}` });
    for (const c of g.companies ?? []) if (c !== 'conts' && c !== 'dream_crafter') bad.push({ id: g.id, problem: `unknown company ${c}` });
  }
  return bad;
}
