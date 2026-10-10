// Runs tests-pg suites on an in-memory Postgres (PGlite) built from the repo's migrations-pg, for machines
// without a local Postgres cluster. The database lives and dies in this process; nothing else is touched.
//
// Run (from engine/backend): node scripts/pg-tests-on-pglite.mjs tests-pg/renovationProject.pg.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(backend, '..', '..');
const PORT = Number(process.env.PGLITE_TEST_PORT ?? 55439);

const { PGlite } = await import('@electric-sql/pglite');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

const pg = new PGlite({ extensions: { pg_trgm } });
for (const r of ['pos_app', 'service_role', 'anon', 'authenticated']) {
  await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r}; end if; end $$;`);
}
await pg.exec('create schema if not exists extensions');
const migrations = readdirSync(join(root, 'migrations-pg')).filter((f) => f.endsWith('.sql')).sort();
for (const f of migrations) {
  try {
    await pg.exec(`begin;\n${readFileSync(join(root, 'migrations-pg', f), 'utf8')}\ncommit;`);
  } catch (e) {
    await pg.exec('rollback;').catch(() => {});
    console.error(`migration ${f} failed on PGlite: ${String(e.message).slice(0, 200)}`);
    process.exit(1);
  }
}
console.log(`${migrations.length} migrations applied (${migrations[0]} .. ${migrations.at(-1)})`);

const server = new PGLiteSocketServer({ db: pg, port: PORT, maxConnections: 1 });
await server.start();
const files = process.argv.slice(2);
// spawn, not spawnSync: the socket server answers on this process's event loop.
const child = spawn('npx', ['vitest', 'run', '--config', 'vitest.pg.config.ts', ...files], {
  cwd: backend,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, TEST_DATABASE_URL: `postgres://postgres@127.0.0.1:${PORT}/houzs_test` },
});
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
await server.stop();
await pg.close();
process.exit(code);
