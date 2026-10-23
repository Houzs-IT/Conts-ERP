// Signed in is not the same as allowed (sister ERPs: Houzs accounting.ts had eleven routes and no permission check).
// Every /api handler is covered by one of:
//   1. an area in functions/_lib/access.ts: its first path segment is listed there, so the session middleware applies
//      the role's level (No access refuses, View refuses writes) and keeps field and owner accounts out;
//   2. its own role or scope check (session.manage / session.role / session.userId, mayWork/maySee/mayRun, levelsFor,
//      MASTER_ROLES, isFieldRole, canSeeFinance, ownerFor, linkedUnitFor), directly or through a _lib function;
//   3. the allow-list below, each with its reason.
// It also fails when the access catalogue names a path segment no handler has, or when the field or owner allow-list
// in the session middleware names a route that does not exist (an allow-list entry nobody can see go stale).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIfMain, read, stripComments, ROOT } from './_lib.mjs';
import { handlerFiles, exportedHandlers, handlerReaches } from './_handlers.mjs';

const ROLE_CHECK = /session\??\.(manage|role|picked|userId)\b|\bmay(Work|See|Run)\s*\(|\blevelsFor\s*\(|\bMASTER_ROLES\b|\bisFieldRole\s*\(|\bcanSeeFinance\s*\(|\bownerFor\s*\(|\blinkedUnitFor\s*\(/;
const ACCESS = 'functions/_lib/access.ts';
const MIDDLEWARE = 'functions/api/_middleware.ts';

export const allow = {
  'functions/api/[[path]].ts': 'Catch-all 404 for unknown /api paths; it returns no data.',
  'functions/api/auth/login.ts': 'Public: signing in is how a session is made.',
  'functions/api/auth/login-2fa.ts': 'Public: second sign-in step; the short-lived challenge from login is the credential.',
  'functions/api/auth/login-pin.ts': 'Public: the field app signs in with phone number and PIN here.',
  'functions/api/auth/forgot-password.ts': 'Public: answers the same whether or not the email exists.',
  'functions/api/auth/reset-password.ts': 'Public: the emailed one-time token is the credential.',
  'functions/api/auth/logout.ts': 'Only clears the caller\'s own cookie.',
  'functions/api/auth/change-password.ts': 'Changes only the signed-in person\'s own password (verified current password).',
  'functions/api/auth/session.ts': 'Answers "who am I" for the caller\'s own cookie.',
  'functions/api/auth/view-as.ts': 'Checks itself that the person who really signed in is management and that VIEW_AS is on (staging only).',
  'functions/api/integrations/channex-webhook.ts': 'Called by Channex, authenticated by the shared webhook secret.',
  'functions/api/supply-chain/engine.ts': 'Says only whether the supply chain engine is switched on (true/false) for the menu.',
  'functions/api/table-layouts/index.ts': 'A person\'s own saved table views; company views are management-only inside (mayShare).',
  'functions/api/coverage-fleet/index.ts': 'Supply chain (Transportation): field and owner accounts are refused by the middleware; same data as drivers/vehicles.',
};

/** Path segments under /api that an area in access.ts claims. */
function areaSegments() {
  const text = read(ACCESS);
  const block = text.slice(text.indexOf('export const AREAS'), text.indexOf('];', text.indexOf('export const AREAS')));
  return new Set([...block.matchAll(/api:\s*\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])));
}

const segmentOf = rel => rel.replace(/^functions\/api\//, '').split('/')[0].replace(/\.ts$/, '');

/** Every route the file tree defines, as a sample path with [param] filled, for testing allow-list regexes. */
function samplePaths() {
  return handlerFiles().flatMap(f => {
    const p = f.replace(/^functions/, '').replace(/\.ts$/, '').replace(/\/index$/, '');
    // An optional catch-all ([[path]]) answers both the folder itself and anything under it.
    if (/\/\[\[[^\]]+\]\]$/.test(p)) { const base = p.replace(/\/\[\[[^\]]+\]\]$/, '').replace(/\[[^\]]+\]/g, 'x1'); return [base, `${base}/x/y`]; }
    return [p.replace(/\[[^\]]+\]/g, 'x1')];
  });
}

function scanAccess(text, segs = areaSegments()) {
  const dirs = new Set(fs.readdirSync(path.join(ROOT, 'functions/api')).map(n => n.replace(/\.ts$/, '')));
  const hits = [];
  for (const s of segs) if (!dirs.has(s)) hits.push({ line: 0, msg: `area segment '${s}' has no handler under functions/api (renamed or removed?)` });
  void text;
  return hits;
}

function scanMiddleware(text, paths = samplePaths()) {
  const hits = [];
  for (const name of ['OWNER_ALLOWED', 'FIELD_ALLOWED']) {
    const at = text.indexOf(`${name}:`);
    if (at < 0) { hits.push({ line: 0, msg: `${name} not found in the session middleware` }); continue; }
    const block = text.slice(at, text.indexOf('];', at));
    for (const m of block.matchAll(/\['(GET|POST|PUT|PATCH|DELETE)',\s*\/(.+)\/\],?\s*$/gm)) {
      const re = new RegExp(m[2]);
      if (!paths.some(p => re.test(p))) hits.push({ line: 0, msg: `${name} entry ${m[1]} /${m[2]}/ matches no route` });
    }
  }
  return hits;
}

export const def = {
  name: 'require-permission',
  rule: 'every functions/api handler is in an access.ts area, checks the role or scope itself, or is allow-listed with a reason',
  files: () => [...handlerFiles(), ACCESS, MIDDLEWARE],
  allow,
  scan(text, rel) {
    if (rel === ACCESS) return scanAccess(text);
    if (rel === MIDDLEWARE) return scanMiddleware(text);
    const code = stripComments(text);
    if (exportedHandlers(code).length === 0) return [];
    if (rel.startsWith('functions/api/') && areaSegments().has(segmentOf(rel))) return [];
    return handlerReaches(code, rel, ROLE_CHECK) ? [] : [{ line: 0, msg: `no permission check: '/api/${segmentOf(rel)}' is in no access.ts area and the handler checks no role or scope` }];
  },
  selfTest: {
    bad: [
      { path: 'functions/api/zzz-new/index.ts', text: "export const onRequestGet = async ({ request, env }) => {\n  const { session } = await requireSession(request, env);\n  return json(await all(env, 'SELECT * FROM owners'));\n};\n// session.role\n" },
    ],
    good: [
      { path: 'functions/api/zzz-new/index.ts', text: "export const onRequestGet = async ({ request, env }) => {\n  const { session } = await requireSession(request, env);\n  if (!session.manage) return fail('FORBIDDEN', 'No.', 403);\n};\n" },
      { path: 'functions/api/owners/zzz.ts', text: "export const onRequestGet = async () => json({});\n" },
    ],
  },
};

// The two catalogue checks prove they can fail too.
export function extraSelfTest() {
  const problems = [];
  if (scanAccess('', new Set(['no-such-segment'])).length !== 1) problems.push('access catalogue drift not caught');
  if (scanMiddleware("const OWNER_ALLOWED: [string, RegExp][] = [\n  ['GET', /^\\/api\\/nowhere$/],\n];\nconst FIELD_ALLOWED: [string, RegExp][] = [\n];", ['/api/owners']).length !== 1) problems.push('stale allow-list entry not caught');
  if (scanMiddleware("const OWNER_ALLOWED: [string, RegExp][] = [\n  ['GET', /^\\/api\\/owners$/],\n];\nconst FIELD_ALLOWED: [string, RegExp][] = [\n];", ['/api/owners']).length !== 0) problems.push('a live allow-list entry was flagged');
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = extraSelfTest();
  if (p.length) { console.log('FAIL require-permission: ' + p.join('; ')); process.exit(1); }
}
runIfMain(import.meta.url, def);
