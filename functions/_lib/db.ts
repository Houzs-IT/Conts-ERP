/** D1 helpers. Money is integer sen everywhere — never a float, never a REAL column. */

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

export async function all<T = Record<string, unknown>>(env: Env, sql: string, ...args: unknown[]) {
  const r = await env.DB.prepare(sql).bind(...args).all<T>();
  return r.results ?? [];
}

export async function one<T = Record<string, unknown>>(env: Env, sql: string, ...args: unknown[]) {
  return (await env.DB.prepare(sql).bind(...args).first<T>()) ?? null;
}

export async function run(env: Env, sql: string, ...args: unknown[]) {
  return env.DB.prepare(sql).bind(...args).run();
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
