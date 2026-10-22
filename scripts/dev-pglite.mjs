// A throwaway Postgres for looking at the app in a browser without a local Postgres install or any password:
// PGlite in this process, every migration in migrations-pg, the demo data (scripts/local-demo-setup.mjs), served on
// a local port. Point the dev server at it:
//
//   node scripts/dev-pglite.mjs                       (leave it running; PORT defaults to 55441)
//   WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://pos_app:local@127.0.0.1:55441/postgres npm run dev:os
//
// Everything lives in memory and is gone when this process stops. One session (PGlite is single-user), shared by up to 20 connections.
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

// More than one connection: each API request and each transaction opens its own (functions/_lib/db.ts). With the default
// of 1, a transaction (making a reservation) waited forever for a connection and every later request hung behind it.
const server = new PGLiteSocketServer({ db: pg, port: PORT, maxConnections: 20 });
// The socket server queues single protocol messages, so two connections' Parse/Bind/Execute could interleave in PGlite's
// one session ("unnamed prepared statement does not exist"). Keep a connection's extended-protocol messages together up
// to its Sync, and a transaction's statements together up to its end, as a real server would.
const STICKY = new Set([0x50, 0x42, 0x44, 0x45, 0x43, 0x48]); // Parse, Bind, Describe, Execute, Close, Flush
const queue = server.queryQueue;
queue.sticky = null;
queue.processQueue = async function () {
  if (this.processing || this.queue.length === 0) return;
  this.processing = true;
  while (this.queue.length > 0) {
    const owner = this.sticky ?? (this.db.isInTransaction() ? this.lastHandlerId : null);
    const at = owner == null ? 0 : this.queue.findIndex(q => q.handlerId === owner);
    if (at === -1) break; // that connection's next message has not arrived yet; it restarts the queue when it does
    const item = this.queue.splice(at, 1)[0];
    try {
      await this.db.runExclusive(() => this.db.execProtocolRawStream(item.message, { onRawData: d => item.onData(d) }));
    } catch (e) {
      this.sticky = null;
      item.reject(e);
      continue;
    }
    this.lastHandlerId = item.handlerId;
    this.sticky = STICKY.has(item.message[0]) ? item.handlerId : null;
    item.resolve(0);
  }
  this.processing = false;
};
const clearFor = queue.clearQueueForHandler.bind(queue);
queue.clearQueueForHandler = function (id) {
  clearFor(id);
  if (this.sticky === id) { this.sticky = null; setImmediate(() => this.processQueue()); }
};
await server.start();
const url = `postgres://pos_app:local@127.0.0.1:${PORT}/postgres`;
// Async on purpose: the socket server answers from this process's event loop, which a sync child would block.
await new Promise((resolve, reject) => {
  spawn(process.execPath, ['scripts/local-demo-setup.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } })
    .on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`local-demo-setup exited ${code}`))));
});
await pg.exec('set search_path = pos, public');
console.log(`ready: ${url}`);
