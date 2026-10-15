// The whole system on this computer, on demo data, with no real database or password: npm run dev:all
//   rental app      http://localhost:8788   (demo logins, password printed below)
//   engine server   http://localhost:8790   (port the demo seeder and api-checks expect)
//   engine screens  http://localhost:5173   (opened from the rental app: Projects, Supply Chain)
// Each app gets its own in-memory PGlite (scripts/dev-pglite.mjs). The engine's /api/scm routes (catalog, sales,
// procurement, warehouse, transport) read through PostgREST, which PGlite cannot serve: those pages need staging
// until a local Postgres + PostgREST is set up.
// The single sign-on secret is a random one kept in engine/backend/.dev.vars (gitignored, made on first run),
// so nothing here can open staging or production. Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secret = () => randomBytes(32).toString('hex');
const engineVars = join(root, 'engine/backend/.dev.vars');
let sso = existsSync(engineVars) && readFileSync(engineVars, 'utf8').match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!sso) {
  sso = secret();
  writeFileSync(engineVars, `${existsSync(engineVars) ? `${readFileSync(engineVars, 'utf8').trimEnd()}\n` : ''}CONTS_SSO_SECRET=${sso}\n`);
}
const kids = [];
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  // A shell child on Windows leaves its own children running unless the whole tree is killed.
  for (const p of kids) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  }
  process.exit();
}
process.on('SIGINT', stop);

function run(name, cmd, cwd, env, readyText) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { cwd: join(root, cwd), shell: true, env: { ...process.env, ...env } });
    kids.push(p);
    const print = (chunk) => {
      const text = String(chunk);
      for (const line of text.split(/\r?\n/)) if (line.trim()) console.log(`[${name}] ${line}`);
      if (readyText && text.includes(readyText)) resolve();
    };
    p.stdout.on('data', print);
    p.stderr.on('data', print);
    p.on('exit', (code) => { if (!stopping) { console.log(`[${name}] stopped (exit ${code}), stopping the rest`); stop(); } });
    if (!readyText) resolve();
  });
}

const rentalDb = 'postgres://pos_app:local@127.0.0.1:55441/postgres';
const engineDb = 'postgres://pos_app:local@127.0.0.1:55442/postgres';
await Promise.all([
  run('rental-db', 'node scripts/dev-pglite.mjs', '.', { PORT: '55441' }, 'ready:'),
  run('engine-db', 'node scripts/dev-pglite.mjs', '.', { PORT: '55442', SEARCH_PATH: 'public, extensions' }, 'ready:'),
]);

run('rental', [
  'npx vite build && npx wrangler pages dev --port 8788',
  `--binding SESSION_SECRET=${secret()}`,
  '--binding SCM_ENGINE_API=http://localhost:8790',
  '--binding SCM_ENGINE_SITE=http://localhost:5173',
  `--binding SCM_ENGINE_SSO_SECRET=${sso}`,
].join(' '), '.', { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: rentalDb });

// Dev builds call VITE_API_URL directly; pointing it at the screens' own address keeps calls same-origin,
// and the Vite proxy passes them on to the engine server.
run('screens', 'npx vite --port 5173 --strictPort', 'engine/frontend', {
  VITE_API_URL: 'http://localhost:5173',
  VITE_DEV_API_PROXY_TARGET: 'http://localhost:8790',
});

await run('engine', 'npx wrangler dev --port 8790 --var PUBLIC_APP_URL:http://localhost:8788', 'engine/backend',
  { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: engineDb }, 'Ready on');
console.log('\nAll running. Open http://localhost:8788 and sign in as management@theconts.com.\n'
  + 'Catalog, sales, procurement, warehouse and transport pages need staging (no local PostgREST).\n');
