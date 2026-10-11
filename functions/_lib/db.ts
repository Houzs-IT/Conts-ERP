/** Postgres helpers (Supabase, schema `pos`, reached through Hyperdrive). Money is
 *  integer sen everywhere — never a float. Call sites still write `?` placeholders;
 *  they are numbered ($1, $2, …) here so the rest of the API needed no rewrite. */
import postgres from 'postgres';
// @ts-expect-error -- node:async_hooks comes from the nodejs_compat flag (wrangler.toml); the project has no @types/node.
import { AsyncLocalStorage as ALS } from 'node:async_hooks';

export interface Env {
  HYPERDRIVE: { connectionString: string };
  SESSION_SECRET: string;
  /** R2 bucket for photos and documents (theconts-media / theconts-media-staging). Optional in the
   *  type since local dev without the binding still needs upload endpoints to fail cleanly (501). */
  MEDIA?: R2Bucket;
  /** Channex channel-manager API key. Set on the preview environment only while we test against their staging demo property — see TODO.md. */
  CHANNEX_API_KEY?: string;
  /** Shared secret Channex sends back as X-Channex-Webhook-Secret on every webhook call, so we can tell a real Channex call from anyone else who finds the URL. */
  CHANNEX_WEBHOOK_SECRET?: string;
  /** Channex server (wrangler.toml var): https://staging.channex.io on preview, https://app.channex.io on production. */
  CHANNEX_BASE_URL?: string;
  /** The supply chain engine (engine/): its server, its site, and the secret the two servers share for
   *  signing people in. Supply chain uses the built-in screens wherever these are not all set. */
  SCM_ENGINE_API?: string;
  SCM_ENGINE_SITE?: string;
  SCM_ENGINE_SSO_SECRET?: string;
  /** "staging" on the preview environment only: lets management view the system as another account
   *  (functions/api/auth/view-as.ts). Never set on production. */
  VIEW_AS?: string;
  /** Encrypts each person's two-step sign-in secret at rest (functions/_lib/twoFactor.ts). Without it, setting up
   *  two-step sign-in is refused with a plain message; signing in with a password still works. */
  TOTP_ENC_KEY?: string;
  /** Set only on the copy of env that transaction() hands its callback: every query through that copy runs on the
   *  transaction's one connection. Never set in wrangler. */
  TX?: postgres.TransactionSql;
}

// count(*) and sum() come back from Postgres as strings (int8 / numeric). The API
// and the UI treat them as numbers, so parse them here once.
const types = {
  number: { to: 20, from: [20, 1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
};

const numbered = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

/** Connections one request's client may hold open at once. Production reaches Supabase through its session pooler,
 *  which admits 15 clients in all (log: "EMAXCONNSESSION max clients reached in session mode - max clients are
 *  limited to pool_size: 15", 11 Oct 2026). Each statement used to open and close its own connection, about 20 for
 *  one unit page. One connection per request is enough: postgres.js sends a request's statements down it back to back
 *  without waiting for each answer. Measured against a 15-client Postgres with ten people opening unit pages at once,
 *  1 gave a 45 ms median and 60-95 ms slowest; 2 and 3 were no faster in the middle and ran over the limit, so their
 *  slowest pages waited 0.4-1.7 s on the retry below. */
const PER_REQUEST = 1;

const open = (env: Env, max: number) =>
  postgres(env.HYPERDRIVE.connectionString, { max, prepare: false, fetch_types: false, types });

/** The pooler refuses a connection that would exceed its client limit before any statement is sent, so retrying
 *  that refusal cannot run anything twice. Any other error is thrown as it is. */
// Supabase's pooler says EMAXCONNSESSION; Postgres itself says "too many clients" / "remaining connection slots are reserved".
const poolFull = (e: unknown) => /EMAXCONNSESSION|max clients reached|too many clients|remaining connection slots/i.test(e instanceof Error ? e.message : String(e));

async function retryPoolFull<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      if (!poolFull(e) || attempt >= 5) throw e;
      await new Promise(r => setTimeout(r, 100 * 2 ** attempt + Math.random() * 100));
    }
  }
}

/** A client of its own, closed when `work` ends: for code outside a request (the scheduled worker), background work
 *  that outlives its request's client, and transactions. */
async function onOwnConnection<T>(work: (db: postgres.Sql) => Promise<T>, env: Env): Promise<T> {
  return retryPoolFull(async () => {
    const db = open(env, 1);
    try {
      return await work(db);
    } finally {
      await db.end({ timeout: 0 });
    }
  });
}

/** One client per request, opened on its first statement and closed once the response is ready. A Worker may not use a socket opened by another request, so a client is
 *  never shared across requests: each request gets its own store through `withRequestDb` (functions/api/_middleware.ts). */
interface RequestDb { db?: postgres.Sql; closed: boolean }
interface Store<T> { run<R>(store: T, fn: () => R): R; getStore(): T | undefined }
const requestDb: Store<RequestDb> = new ALS();

export async function withRequestDb<T>(fn: () => Promise<T>, waitUntil: (p: Promise<unknown>) => void): Promise<T> {
  const store: RequestDb = { closed: false };
  try {
    return await requestDb.run(store, fn);
  } finally {
    // Marked closed first, so a statement from work queued with waitUntil that starts later opens its own client;
    // one already running on this client is let finish (up to 10 s) before the sockets close.
    store.closed = true;
    const db = store.db;
    store.db = undefined;
    if (db) waitUntil(db.end({ timeout: 10 }).catch(() => {}));
  }
}

/** The role `pos_app` has search_path = pos, so table names stay unqualified. */
async function query<T>(env: Env, sql: string, args: unknown[]): Promise<T[]> {
  if (env.TX) return (await env.TX.unsafe(numbered(sql), args as never[])) as unknown as T[];
  const store = requestDb.getStore();
  if (!store || store.closed) {
    return onOwnConnection(async db => (await db.unsafe(numbered(sql), args as never[])) as unknown as T[], env);
  }
  const db = store.db ??= open(env, PER_REQUEST);
  return retryPoolFull(async () => (await db.unsafe(numbered(sql), args as never[])) as unknown as T[]);
}

/** Runs `fn` in one database transaction: every all/one/run/audit given the env it receives commits together, or
 *  none of them does if it throws. Used where a money action and its approval must land as one. It takes a connection
 *  of its own rather than one of the request's: a statement inside `fn` that was given the outer env would otherwise
 *  wait for the very connection the transaction holds. */
export async function transaction<T>(env: Env, fn: (tx: Env) => Promise<T>): Promise<T> {
  if (env.TX) return fn(env);
  return onOwnConnection(async db => (await db.begin(sql => fn({ ...env, TX: sql }))) as T, env);
}

export async function all<T = Record<string, unknown>>(env: Env, sql: string, ...args: unknown[]) {
  return query<T>(env, sql, args);
}

export async function one<T = Record<string, unknown>>(env: Env, sql: string, ...args: unknown[]) {
  return (await query<T>(env, sql, args))[0] ?? null;
}

export async function run(env: Env, sql: string, ...args: unknown[]) {
  await query(env, sql, args);
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** The error envelope every endpoint uses — see api.md. `message` is user-safe. */
export function fail(code: string, message: string, status = 400, fields?: Record<string, string>) {
  return json({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

export function nowIso() { return new Date().toISOString(); }

/** Today's date in Kuala Lumpur, yyyy-mm-dd. The Worker's clock is UTC, so nowIso().slice(0, 10) is yesterday until 08:00. */
export function mytToday() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }

/** A unique-number clash (Postgres 23505 on a ..._number_key / ..._no_key constraint): two documents picked the same
 *  next number at the same moment. The caller takes the next number and tries again. */
export function isNumberClash(e: unknown) {
  const x = e as { code?: string; constraint_name?: string } | null;
  return x?.code === '23505' && /_(?:number|no)_key$/.test(x.constraint_name ?? '');
}

/** Audit is not optional on financial or destructive actions — see schema.sql. */
export async function audit(env: Env, e: {
  actorId: string | null; actorLabel: string; action: string;
  entityTable: string; entityId: string;
  before?: unknown; after?: unknown; source?: string;
}) {
  await run(env,
    `INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.actorId, e.actorLabel, e.action, e.entityTable, e.entityId,
    e.before ? JSON.stringify(e.before) : null,
    e.after ? JSON.stringify(e.after) : null,
    e.source ?? 'web', nowIso(),
  );
}
