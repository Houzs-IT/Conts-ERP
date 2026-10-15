// A throwaway Postgres for looking at the app in a browser without a local Postgres install or any password:
// PGlite in this process, every migration in migrations-pg, the demo data (scripts/local-demo-setup.mjs), served on
// a local port. Point the dev server at it:
//
//   node scripts/dev-pglite.mjs                       (leave it running; PORT defaults to 55441)
//   WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://pos_app:local@127.0.0.1:55441/postgres npm run dev
//
// Everything lives in memory and is gone when this process stops. npm run dev:all starts the rental app and the engine
// on two of these.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 55441);
// The engine's tables are in public, and its users/roles would resolve to pos.users under the rental app's path.
const SEARCH_PATH = process.env.SEARCH_PATH ?? 'pos, public';

const { PGlite } = await import('@electric-sql/pglite');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
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

// Many connections share PGlite's one session. A connection owns it from its first message until PGlite answers
// ReadyForQuery outside a transaction; the others wait their turn. pglite-socket only does one connection (a
// browser's parallel requests then hang) or queues single messages, which mixes two connections' Parse/Bind
// steps ("unnamed prepared statement does not exist").
let owner = null;
const waiting = [];
const take = (id) => new Promise((go) => { if (owner === null || owner === id) { owner = id; go(); } else waiting.push([id, go]); });
const give = (id) => {
  if (owner !== id) return;
  const next = waiting.shift();
  owner = next ? next[0] : null;
  next?.[1]();
};

let lastId = 0;
const server = createServer((socket) => {
  const id = ++lastId;
  let buf = Buffer.alloc(0);
  let started = false;
  let status = 'I';
  let chain = Promise.resolve();

  const run = async (batch, complete) => {
    await take(id);
    if (socket.destroyed) return give(id);
    const out = [];
    await pg.runExclusive(() => pg.execProtocolRawStream(batch, {
      onRawData: (d) => { const b = Buffer.from(d); out.push(b); if (!socket.destroyed) socket.write(b); },
    }));
    const res = Buffer.concat(out);
    for (let i = 0; i + 5 <= res.length; i += 1 + res.readInt32BE(i + 1)) if (res[i] === 0x5a) status = String.fromCharCode(res[i + 5]);
    if (status === 'I' && complete) give(id);
  };

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const msgs = [];
    // Hand over only after a Sync, a simple Query or the startup: a pipelined Parse/Bind can arrive in two packets.
    let complete = false;
    for (;;) {
      if (!started) {
        if (buf.length < 8 || buf.length < buf.readInt32BE(0)) break;
        const len = buf.readInt32BE(0), code = buf.readInt32BE(4);
        if (code === 80877102) return socket.destroy(); // cancel request: not supported
        if (code === 80877103 || code === 80877104) socket.write('N'); // SSL / GSS: no
        else { msgs.push(buf.subarray(0, len)); started = true; complete = true; }
        buf = buf.subarray(len);
      } else {
        if (buf.length < 5 || buf.length < 1 + buf.readInt32BE(1)) break;
        const len = 1 + buf.readInt32BE(1);
        if (buf[0] === 0x58) { socket.end(); break; } // Terminate
        complete = buf[0] === 0x53 || buf[0] === 0x51;
        msgs.push(buf.subarray(0, len));
        buf = buf.subarray(len);
      }
    }
    if (msgs.length) {
      const batch = Buffer.concat(msgs), done = complete;
      chain = chain.then(() => run(batch, done)).catch(() => socket.destroy());
    }
  });
  const done = () => {
    chain = chain.then(async () => {
      if (owner === id) { if (status !== 'I') await pg.exec('rollback').catch(() => {}); give(id); }
      const i = waiting.findIndex(([w]) => w === id);
      if (i >= 0) waiting.splice(i, 1);
    });
  };
  socket.on('close', done);
  socket.on('error', () => socket.destroy());
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const url = `postgres://pos_app:local@127.0.0.1:${PORT}/postgres`;
// Async on purpose: the socket server answers from this process's event loop, which a sync child would block.
await new Promise((resolve, reject) => {
  spawn(process.execPath, ['scripts/local-demo-setup.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } })
    .on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`local-demo-setup exited ${code}`))));
});
await pg.exec(`set search_path = ${SEARCH_PATH}`);
console.log(`ready: ${url}`);
