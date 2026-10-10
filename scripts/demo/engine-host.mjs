// Runs a renovation demo browser snippet from Node, against an engine reached over HTTP.
//
// The browser snippets (renovation-demo-*.browser.js) are the only copy of the seed and cleanup logic:
// this file evaluates the same file in a sandbox with a small host object (base URL, auth header,
// confirm, where to save the manifest), so what is tested locally is exactly what the owner pastes.
//
// Auth, in this order:
//   ENGINE_TOKEN (environment)  a bearer token for that engine (optional ENGINE_SESSION_PASS). Any engine URL.
//   otherwise                   a local engine only: signs on through /api/conts-sso with the
//                               CONTS_SSO_SECRET in engine/backend/.dev.vars, as management with Full
//                               in every area (the role the owner uses). Same as scripts/api-checks.
// Nothing secret is written to disk or printed.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import vm from 'node:vm';

export function parseArgs(argv) {
  const out = { engine: process.env.ENGINE ?? 'http://localhost:8790', again: false, yes: false, manifest: null };
  for (const a of argv) {
    if (a === '--again') out.again = true;
    else if (a === '--yes') out.yes = true;
    else if (a.startsWith('--engine=')) out.engine = a.slice(9);
    else if (a.startsWith('--manifest=')) out.manifest = a.slice(11);
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`Unknown option ${a}`); process.exit(2); }
  }
  out.engine = out.engine.replace(/\/+$/, '');
  return out;
}

export const isLocal = (url) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];

export async function engineHeaders(engine) {
  if (process.env.ENGINE_TOKEN) {
    return { authorization: `Bearer ${process.env.ENGINE_TOKEN}`, ...(process.env.ENGINE_SESSION_PASS ? { 'x-session-pass': process.env.ENGINE_SESSION_PASS } : {}) };
  }
  if (!isLocal(engine)) throw new Error(`${engine} is not a local engine. For a remote engine set ENGINE_TOKEN, or use the browser snippet on the live site.`);
  const vars = readFileSync(new URL('../../engine/backend/.dev.vars', import.meta.url), 'utf8');
  const secret = vars.match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
  if (!secret) throw new Error('CONTS_SSO_SECRET not found in engine/backend/.dev.vars');
  const body = b64url(JSON.stringify({ email: 'renovation-demo@theconts.test', name: 'Renovation demo seed', role: 'management', access: Object.fromEntries(AREAS.map((k) => [k, 'full'])), exp: Date.now() + 45_000 }));
  const r = await fetch(`${engine}/api/conts-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assertion: `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}` }) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200 || !j.token) throw new Error(`engine sign-on refused: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return { authorization: `Bearer ${j.token}`, ...(j.session_pass ? { 'x-session-pass': j.session_pass } : {}) };
}

export async function askConfirm(question, { yes, engine }) {
  console.log(`\n${question}\n`);
  if (yes && isLocal(engine)) return true;
  if (!process.stdin.isTTY) { console.log(isLocal(engine) ? 'Not a terminal: pass --yes to go ahead.' : 'Not a terminal: a remote engine needs a typed confirmation.'); return false; }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const want = isLocal(engine) ? 'yes' : new URL(engine).host;
  const a = (await rl.question(`Type "${want}" to go ahead: `)).trim();
  rl.close();
  return a === want;
}

/** Evaluates a browser snippet with the given host and options; resolves to what the snippet returns. */
export async function runSnippet(file, host, options = {}) {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8');
  const context = vm.createContext({
    RENO_DEMO_HOST: host, RENO_DEMO_OPTIONS: options,
    fetch, FormData, Blob, URL, Headers, Response, crypto: globalThis.crypto, atob, btoa, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, console, structuredClone, Error, Promise, JSON, Math, Date, Uint8Array,
  });
  return vm.runInContext(code, context, { filename: file });
}
