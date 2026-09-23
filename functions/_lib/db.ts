/** Postgres helpers (Supabase, schema `pos`, reached through Hyperdrive). Money is
 *  integer sen everywhere — never a float. Call sites still write `?` placeholders;
 *  they are numbered ($1, $2, …) here so the rest of the API needed no rewrite. */
import postgres from 'postgres';

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
}

// count(*) and sum() come back from Postgres as strings (int8 / numeric). The API
// and the UI treat them as numbers, so parse them here once.
const types = {
  number: { to: 20, from: [20, 1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
};

const numbered = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

/** One short-lived connection per statement. Workers cannot share a connection across
 *  requests, and Hyperdrive keeps the real pool warm, so this is cheap. The role
 *  `pos_app` has search_path = pos, so table names stay unqualified. */
async function query<T>(env: Env, sql: string, args: unknown[]): Promise<T[]> {
  const db = postgres(env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false, types });
  try {
    return (await db.unsafe(numbered(sql), args as never[])) as unknown as T[];
  } finally {
    await db.end({ timeout: 0 });
  }
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
