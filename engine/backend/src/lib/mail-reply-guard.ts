// Mail Center reply guard helpers (owner 2026-11-21), read by the reply route in
// routes/mail-center.ts and by routes/mail-reply-guard.ts. Conts: moved out of the
// route file (Houzs keeps them there) so mail-center.ts and mail-reply-guard.ts do
// not import each other (engine/scripts/check-import-cycles.mjs).
import type { Context } from "hono";
import type { Env } from "../types";
import { activeCompanySql } from "../scm/lib/companyScope";

type C = Context<{ Bindings: Env }>;
type Db = Env["DB"];

/** A "writing" mark older than this is someone who left; the box beats every 20 s. */
export const REPLYING_FRESH_MS = 90_000;

/** Colleagues (not me) with text in this thread's reply box in the last 90 s. */
export async function replyingOn(db: Db, threadId: string, me: number | null): Promise<Array<{ name: string }>> {
  try {
    const since = new Date(Date.now() - REPLYING_FRESH_MS).toISOString();
    // company-scope: thread_id was already read inside the active company by the caller.
    const res = await db
      .prepare(
        `SELECT u.name, u.email FROM mail_thread_replying r JOIN users u ON u.id = r.user_id
          WHERE r.thread_id = ? AND r.at > ? AND r.user_id <> ? ORDER BY r.at`,
      )
      .bind(threadId, since, me ?? -1)
      .all<{ name: string | null; email: string | null }>();
    return res.results.map((r) => ({ name: r.name?.trim() || r.email || "A colleague" }));
  } catch {
    return []; // table not there yet (D1 test mirror): nobody shown
  }
}

/** An outbound reply someone else sent after `afterMessageId`, or null. */
export async function replyConflict(
  db: Db,
  threadId: string,
  afterMessageId: string | null,
  me: number | null,
): Promise<{ by: string; at: string } | null> {
  if (!afterMessageId) return null;
  // company-scope: thread_id was already read inside the active company by the caller.
  const row = await db
    .prepare(
      `SELECT m.created_at, m.sent_by_name, m.from_name FROM email_messages m
        WHERE m.thread_id = ? AND m.direction = 'outbound'
          AND m.created_at > (SELECT created_at FROM email_messages WHERE id = ? AND thread_id = ?)
          AND (m.sent_by_user_id IS NULL OR m.sent_by_user_id <> ?)
        ORDER BY m.created_at DESC LIMIT 1`,
    )
    .bind(threadId, afterMessageId, threadId, me ?? -1)
    .first<{ created_at: string; sent_by_name: string | null; from_name: string | null }>();
  if (!row) return null;
  return { by: row.sent_by_name?.trim() || row.from_name?.trim() || "A colleague", at: row.created_at };
}

/** After my reply: I am no longer writing, and an unassigned email becomes mine. */
export async function afterReplySent(c: C, threadId: string, assigned: number | null, me: number | null, name: string | null): Promise<void> {
  if (me == null) return;
  // Best effort: the reply is already sent, and a stale mark expires on its own in 90 s.
  await c.env.DB.prepare(`DELETE FROM mail_thread_replying WHERE thread_id = ? AND user_id = ?`)
    .bind(threadId, me)
    .run()
    .catch((e: unknown) => console.warn("[mail] could not clear replying mark", e));
  if (assigned != null) return;
  await c.env.DB.prepare(
    `UPDATE email_threads SET assigned_to_user_id = ?, assigned_to_name = ? WHERE id = ? AND assigned_to_user_id IS NULL${activeCompanySql(c)}`,
  )
    .bind(me, name, threadId)
    .run();
}
