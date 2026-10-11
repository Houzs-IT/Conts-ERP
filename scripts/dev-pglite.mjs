// A throwaway Postgres for looking at the app in a browser without a local Postgres install or any password:
// PGlite in this process, every migration in migrations-pg, the demo data (scripts/local-demo-setup.mjs), served on
// a local port. Point the dev server at it:
//
//   node scripts/dev-pglite.mjs                       (leave it running; PORT defaults to 55441)
//   WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://pos_app:local@127.0.0.1:55441/postgres npm run dev
//
// Everything lives in memory and is gone when this process stops. One connection at a time (PGlite is single-user).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 55441);

const { PGlite } = await import('@electric-sql/pglite');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const pg = new PGlite({ extensions: { pg_trgm } });

// What Supabase provides before the first migration runs (same as scripts/ci-api-db.mjs).
for (const role of ['anon', 'authenticated', 'service_role']) {
  await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
}
await pg.exec('create schema if not exists extensions');

const failed = [];
for (const f of readdirSync(join(root, 'migrations-pg')).filter((x) => x.endsWith('.sql')).sort()) {
  try { await pg.exec(`begin;\n${readFileSync(join(root, 'migrations-pg', f), 'utf8')}\ncommit;`); }
  catch (e) { await pg.exec('rollback').catch(() => {}); failed.push(`${f}: ${e.message}`); }
}
console.log(failed.length ? `migrations that did not apply on PGlite:\n  ${failed.join('\n  ')}` : 'all migrations applied');
await pg.exec('set search_path = pos, public');

const server = new PGLiteSocketServer({ db: pg, port: PORT });
await server.start();
const url = `postgres://pos_app:local@127.0.0.1:${PORT}/postgres`;
// Async on purpose: the socket server answers from this process's event loop, which a sync child would block.
await new Promise((resolve, reject) => {
  spawn(process.execPath, ['scripts/local-demo-setup.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } })
    .on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`local-demo-setup exited ${code}`))));
});
await pg.exec('set search_path = pos, public');
console.log(`ready: ${url}`);
