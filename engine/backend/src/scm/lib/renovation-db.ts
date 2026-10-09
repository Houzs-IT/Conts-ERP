/* Database access for the renovation sales documents (phase 2).

   The renovation libraries speak plain SQL through one tiny interface, RenoDb,
   instead of the PostgREST facade: every multi-row write (convert a quotation,
   raise POs, bill an instalment, apply a VO) runs in ONE real transaction, and
   the same code runs unchanged against PGlite in scripts/api-checks/renovation-sales.mjs.

   Anything with postgres.js's `unsafe(text, params)` is accepted (a Sql client
   or a transaction), so phase 3 can call billingView with its own connection. */

import type { Sql } from 'postgres';
import { getSql, resolveDatabaseUrl } from '../../db/pg';

export interface RenoDb {
  q<T = Record<string, any>>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface UnsafeRunner {
  unsafe(text: string, params?: any[]): PromiseLike<any>;
}

export function renoDbOf(runner: UnsafeRunner | RenoDb): RenoDb {
  if ('q' in runner && typeof runner.q === 'function') return runner;
  const r = runner as UnsafeRunner;
  return {
    async q<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const rows = await r.unsafe(text, params.map((p) => (p === undefined ? null : p)) as any[]);
      return Array.from(rows as ArrayLike<T>);
    },
  };
}

/** A refusal the route turns into JSON with this status. Throwing it inside a
    transaction rolls the transaction back. */
export class RenoError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const refuse = (status: RenoError['status'], code: string, message: string, detail?: Record<string, unknown>) =>
  new RenoError(status, code, message, detail);

/** "2026-10-09" -> "2610". */
export function yymmOf(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(isoDate);
  if (!m) throw refuse(400, 'invalid_date', `Not a date: ${isoDate}`);
  return `${m[1].slice(2)}${m[2]}`;
}

export function todayKl(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Next `<monthPrefix>-NNN` for a numbered table, inside the caller's
    transaction: the live max is the floor and scm.next_doc_no_n (the engine's
    counter, so a deleted top number is never re-issued) hands out the suffix. */
export async function mintDocNo(db: RenoDb, table: string, col: string, monthPrefix: string, digits = 3): Promise<string> {
  if (!IDENT.test(table) || !IDENT.test(col)) throw new Error(`mintDocNo: unsafe identifier ${table}.${col}`);
  const [floor] = await db.q<{ n: number | null }>(
    `select max(substring(${col} from length($1) + 2)::int) as n
       from scm.${table}
      where ${col} like $1 || '-%' and substring(${col} from length($1) + 2) ~ '^[0-9]+$'`,
    [monthPrefix],
  );
  const [row] = await db.q<{ n: number }>(`select scm.next_doc_no_n($1, $2) as n`, [monthPrefix, Number(floor?.n ?? 0)]);
  const n = Number(row?.n);
  if (!Number.isFinite(n) || n < 1) throw new Error(`next_doc_no_n(${monthPrefix}) returned no usable number`);
  return `${monthPrefix}-${String(n).padStart(digits, '0')}`;
}

export function sqlFor(env: { HYPERDRIVE?: { connectionString: string }; DATABASE_URL?: string }): Sql | null {
  const url = resolveDatabaseUrl(env);
  return url ? getSql(url) : null;
}

/** Run `fn` in one transaction. Effects registered with `afterCommit` run only
    once the transaction has committed, and never fail the request. */
export async function inRenoTx<T>(
  sql: Sql,
  fn: (db: RenoDb, tx: Sql, afterCommit: (effect: () => Promise<void>) => void) => Promise<T>,
): Promise<T> {
  const effects: Array<() => Promise<void>> = [];
  const result = await sql.begin(async (tx) => fn(renoDbOf(tx as unknown as UnsafeRunner), tx as unknown as Sql, (e) => effects.push(e)));
  for (const effect of effects) {
    try { await effect(); } catch (err) { console.error('[renovation] after-commit effect failed:', err); }
  }
  return result as T;
}

/** One audit row on the engine's entity audit log (best-effort: never blocks the write). */
export async function auditEntity(
  db: RenoDb,
  p: { companyId: number; entityType: string; entityId: string; docNo?: string | null; action: string; actorName?: string | null; note?: string; changes?: unknown },
): Promise<void> {
  await db.q(
    `insert into scm.entity_audit_log (company_id, entity_type, entity_id, entity_doc_no, action, actor_name_snapshot, field_changes, note, source)
     values ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8, 'renovation')`,
    [p.companyId, p.entityType, p.entityId, p.docNo ?? null, p.action, p.actorName ?? null, JSON.stringify(p.changes ?? []), p.note ?? null],
  );
}

/** One row on the sales order's own audit log, the one its History tab reads. */
export async function auditSo(
  db: RenoDb,
  p: { companyId: number; docNo: string; action: string; actorName?: string | null; note?: string; status?: string | null; changes?: unknown },
): Promise<void> {
  await db.q(
    `insert into scm.mfg_so_audit_log (so_doc_no, company_id, action, actor_name_snapshot, field_changes, status_snapshot, source, note)
     values ($1, $2, $3, $4, $5::text::jsonb, $6, 'renovation', $7)`,
    [p.docNo, p.companyId, p.action, p.actorName ?? null, JSON.stringify(p.changes ?? []), p.status ?? null, p.note ?? null],
  );
}

export const asInt = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const asIntOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
