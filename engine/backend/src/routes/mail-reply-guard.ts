// Mail Center reply guard (owner 2026-11-21): who is writing a reply right now,
// a reply a colleague sent after the newest message I had seen, and the count of
// customer emails waiting on me for the sidebar.
import { Hono } from "hono";
import type { Env } from "../types";
import { activeCompanyId, activeCompanySql } from "../scm/lib/companyScope";
import { getMailScope } from "./mail-center";

const app = new Hono<{ Bindings: Env }>();

// POST /api/mail-center/threads/:id/replying { drafting } - the reply box heartbeat.
app.post("/threads/:id/replying", async (c) => {
  const id = c.req.param("id");
  const scope = await getMailScope(c);
  if (scope.userId == null) return c.json({ error: "Sign in again." }, 401);
  const thread = await c.env.DB.prepare(`SELECT mailbox_address FROM email_threads WHERE id = ?${activeCompanySql(c)} LIMIT 1`)
    .bind(id)
    .first<{ mailbox_address: string | null }>();
  if (!thread || (!scope.isAdmin && !scope.addresses.includes((thread.mailbox_address ?? "").toLowerCase()))) {
    return c.json({ error: "Thread not found" }, 404);
  }
  const body = await c.req.json<{ drafting?: boolean }>().catch(() => ({}) as { drafting?: boolean });
  if (body.drafting) {
    await c.env.DB.prepare(
      `INSERT INTO mail_thread_replying (thread_id, user_id, company_id, at) VALUES (?, ?, ?, ?)
       ON CONFLICT (thread_id, user_id) DO UPDATE SET at = excluded.at`,
    )
      .bind(id, scope.userId, activeCompanyId(c) ?? null, new Date().toISOString())
      .run();
  } else {
    await c.env.DB.prepare(`DELETE FROM mail_thread_replying WHERE thread_id = ? AND user_id = ?`).bind(id, scope.userId).run();
  }
  return c.json({ ok: true });
});

// GET /api/mail-center/waiting-count - open emails whose last word is the
// customer's, assigned to me or in my own mailbox (sidebar badge, owner A).
app.get("/waiting-count", async (c) => {
  const me = c.get("userId") ?? null;
  if (me == null) return c.json({ count: 0 });
  c.header("Cache-Control", "no-store");
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM email_threads t
      WHERE t.status = 'open' AND t.trashed_at IS NULL AND t.last_direction = 'inbound'${activeCompanySql(c, "t.company_id")}
        AND (t.assigned_to_user_id = ?
             OR (t.assigned_to_user_id IS NULL AND lower(t.mailbox_address) IN (
                 SELECT lower(a.address) FROM email_addresses a
                  WHERE a.assigned_user_id = ? AND a.active = 1${activeCompanySql(c, "a.company_id")})))`,
  )
    .bind(me, me)
    .first<{ n: number | string }>();
  return c.json({ count: Number(row?.n ?? 0) });
});

export default app;
