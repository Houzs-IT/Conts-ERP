// Local dev with the supply chain engine: `npm run dev` (production database) or `npm run dev:staging`.
// Starts Property OS on :8788, the engine's server on :8787 and its screens on :5173, all on one database.
// The database address and the engine's Supabase key come from .dev.vars (DATABASE_URL_STAGING / _PRODUCTION,
// SUPABASE_SERVICE_ROLE_KEY_STAGING / _PRODUCTION).
// Files, photos and the session cache are wrangler's local copies, never the real buckets.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer, connect } from 'node:net';

const PROJECTS = { production: 'cweomoenhsjvsxfsmiiw', staging: 'ecgyrmblqfxvbfjlqkdq' };
const target = process.argv[2];
if (!PROJECTS[target]) { console.error('usage: node scripts/dev.mjs production|staging'); process.exit(2); }
// Older notes run `<local test database> npm run dev`; that must not quietly land on production instead.
if (process.env.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE || process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE) {
  console.error('A database is already set in *_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE. For a local test database use `npm run dev:os`.');
  process.exit(2);
}

// One file for everything; the settings that differ per database carry a _STAGING / _PRODUCTION suffix.
const file = '.dev.vars';
const suffix = target.toUpperCase();
let text = '';
try { text = readFileSync(file, 'utf8'); } catch { /* reported below */ }
const read = key => text.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'))?.[1];
const db = read(`DATABASE_URL_${suffix}`);
const serviceKey = read(`SUPABASE_SERVICE_ROLE_KEY_${suffix}`);
if (!db) { console.error(`${file} needs a DATABASE_URL_${suffix} line (see .dev.vars.example).`); process.exit(2); }
if (!db.includes(PROJECTS[target])) { console.error(`DATABASE_URL_${suffix} in ${file} does not point at the ${target} database (${PROJECTS[target]}).`); process.exit(2); }

// Each run makes its own sign-on secret: only these two local servers need to agree on it.
const sso = randomBytes(32).toString('hex');

const bin = (dir, pkg, path) => resolve(dir, 'node_modules', pkg, path);
// wrangler's own program, not its bin launcher: the launcher can exit first on Ctrl+C and leave this running
// out of reach of the tree kill below.
const wrangler = dir => ['--no-warnings', bin(dir, 'wrangler', 'wrangler-dist/cli.js')];
const hyperdrive = { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: db };

// Fresh debugger ports each run: Windows lets a second workerd bind 9229 while another dev server holds it,
// and wrangler then talks to the wrong one and never answers a request.
const freePort = () => new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(String(port))); }); });
const [osInspector, engineInspector] = [await freePort(), await freePort()];
// The same Windows quirk lets a second server start on a taken port without any error, and then nothing loads.
const taken = port => new Promise(ok => { const c = connect(port, '127.0.0.1', () => { c.destroy(); ok(true); }).on('error', () => ok(false)); });
for (const port of [8787, 8788, 5173]) {
  if (await taken(port)) { console.error(`Port ${port} is already in use by another program. Stop it first (an older dev run or another session).`); process.exit(2); }
}

const build = spawnSync(process.execPath, [bin('.', 'vite', 'bin/vite.js'), 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const staging = target === 'staging'
  ? ['-b', 'APP_NAME=Conts ERP (staging)', '-b', 'VIEW_AS=staging', '-b', 'CHANNEX_BASE_URL=https://staging.channex.io']
  : [];
const apps = [
  ['os', '.', [...wrangler('.'), 'pages', 'dev', '--port', '8788', '--inspector-port', osInspector,
    '-b', 'SCM_ENGINE_API=http://localhost:8787', '-b', 'SCM_ENGINE_SITE=http://localhost:5173', '-b', `SCM_ENGINE_SSO_SECRET=${sso}`, '-b', 'DB_SEARCH_PATH=pos', ...staging],
    hyperdrive],
  ['engine', 'engine/backend', [...wrangler('engine/backend'), 'dev', '--port', '8787', '--inspector-port', engineInspector,
    '--var', `CONTS_SSO_SECRET:${sso}`, '--var', 'PUBLIC_APP_URL:http://localhost:8788',
    ...(serviceKey ? ['--var', `SUPABASE_SERVICE_ROLE_KEY:${serviceKey}`] : [])],
    hyperdrive],
  ['screens', 'engine/frontend', [bin('engine/frontend', 'vite', 'bin/vite.js'), '--port', '5173', '--strictPort'],
    { ...process.env, VITE_API_URL: 'http://localhost:8787' }],
];

console.log(`\n${target} database (${PROJECTS[target]}). Open http://localhost:8788\n`);
const children = apps.map(([name, cwd, args, env]) => {
  // No keyboard for the children, so their shortcut keys do not fight over one terminal. Ctrl+C still reaches them.
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [child.stdout, child.stderr]) {
    s.on('data', d => process.stdout.write(d.toString().replace(/^(?=.)/gm, `[${name}] `)));
  }
  child.on('exit', code => { console.log(`[${name}] stopped (${code})`); stopAll(code ?? 1); });
  return child;
});

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // wrangler starts workerd as its own child; only a tree kill frees the port on Windows.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGINT');
  }
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
