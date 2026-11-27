// Conts only: POST /api/conts-mail-waiting, Mail Center's waiting-for-my-reply count for Property OS's AI Connector
// daily brief (AI Connector round 4, 26 Nov 2026). Server to server, like /api/conts-search: Property OS's server sends a
// one-minute statement of who is asking and their access levels, signed with the single sign-on secret and marked
// aud 'mail-waiting' (functions/_lib/scmEngine.ts mailWaitingAssertion), so a sign-on, claims or search statement never
// passes here and this one passes nowhere else.
//
// READ-ONLY by design (main session, 27 Nov 2026): the connector never makes an engine account, a session or a
// mailbox. A person with no engine account, or with no mailbox of their own yet, gets `count: null` and opened: false
// ("Mail Center not opened yet"); nothing is written. Only people who already have both are counted, with the same
// query as GET /api/mail-center/waiting-count (open threads whose last message is inbound, assigned to them or
// unassigned in their own mailbox). With `?list=1` (AI Connector round 4b, 27 Nov 2026) it also lists those same
// threads (at most 10, longest waiting first) with their newest message id, so the connector can show the person which
// email they are answering and pass the reply guard's afterMessageId. Still read-only.
import { Hono, type MiddlewareHandler } from "hono";
import type { Env } from "../types";
import type { AuthUser } from "../services/auth";
import { companyContext } from "../middleware/companyContext";
import { activeCompanySql } from "../scm/lib/companyScope";
import { parseContsAccess, type ContsAccess } from "./access";
import { mayUseMailCenter } from "./sso";

type ContsEnv = Env & { CONTS_SSO_SECRET?: string };
type Vars = { mailWaitingUserId: number };

const MAX_AGE_MS = 60_000;
const enc = new TextEncoder();
const fromB64url = (v: string) => Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

export interface MailWaitingAssertion { email: string; access: ContsAccess }

/** `base64url(JSON).base64url(HMAC-SHA256)` marked aud 'mail-waiting'. */
export async function verifyMailWaitingAssertion(secret: string, token: string, now = Date.now()): Promise<MailWaitingAssertion | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(body)))) return null;
    const a = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { aud?: unknown; email?: unknown; exp?: unknown; access?: unknown };
    if (a.aud !== "mail-waiting" || typeof a.email !== "string" || !a.email || typeof a.exp !== "number") return null;
    if (a.exp < now || a.exp > now + MAX_AGE_MS) return null;
    const access = parseContsAccess(a.access);
    return access ? { email: a.email.trim().toLowerCase(), access } : null;
  } catch {
    return null;
  }
}

/** The one-row reads this route makes (D1 shape), so the decision is testable with a stand-in. */
export interface MailWaitingDb {
  prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null> } };
}

export const NOT_OPENED_NOTE = "Mail Center not opened yet: open Mail in the ERP once to set up your mailbox.";

/** Who is asking, before any count: refused (403), not opened yet (no engine account / no mailbox of their own), or
 *  the engine user id to count for. Reads only. */
export async function mailWaitingCaller(db: MailWaitingDb, a: MailWaitingAssertion): Promise<
  { kind: "refused"; message: string } | { kind: "not_opened"; reason: "no_engine_account" | "no_mailbox" } | { kind: "ok"; userId: number }
> {
  if (!mayUseMailCenter(a.access)) return { kind: "refused", message: "This account does not have access to Mail Center." };
  const user = await db.prepare(`SELECT id, status FROM users WHERE lower(email) = ?`).bind(a.email).first<{ id: number; status: string }>();
  if (!user) return { kind: "not_opened", reason: "no_engine_account" };
  if (user.status !== "active") return { kind: "refused", message: "This supply chain account is switched off." };
  const box = await db.prepare(`SELECT 1 AS x FROM email_addresses WHERE assigned_user_id = ? AND active = 1 LIMIT 1`).bind(user.id).first<{ x: number }>();
  if (!box) return { kind: "not_opened", reason: "no_mailbox" };
  return { kind: "ok", userId: user.id };
}

const caller: MiddlewareHandler<{ Bindings: ContsEnv; Variables: Vars }> = async (c, next) => {
  const secret = c.env.CONTS_SSO_SECRET;
  if (!secret || secret.length < 32) return c.json({ error: "not_configured", message: "Mail Center is not set up on this server." }, 503);
  const token = c.req.header("x-conts-mail");
  const a = token ? await verifyMailWaitingAssertion(secret, token) : null;
  if (!a) return c.json({ error: "not_verified", message: "The request could not be verified." }, 401);
  const who = await mailWaitingCaller(c.env.DB as unknown as MailWaitingDb, a);
  c.header("Cache-Control", "no-store");
  if (who.kind === "refused") return c.json({ error: "forbidden", message: who.message }, 403);
  if (who.kind === "not_opened") return c.json({ count: null, opened: false, reason: who.reason, note: NOT_OPENED_NOTE });
  /* companyContext reads only the user's id (its user_companies grants). */
  c.set("user", { id: who.userId, email: a.email } as unknown as AuthUser);
  c.set("mailWaitingUserId", who.userId);
  await next();
};

/** At most this many waiting threads are listed (`?list=1`). */
export const WAITING_LIST_LIMIT = 10;

/** One waiting thread as `?list=1` returns it: what Mail Center's inbox row shows the same person, plus the newest
 *  message id, which Property OS's AI Connector sends back as the reply guard's `afterMessageId` (AI Connector round 4b,
 *  27 Nov 2026), so a reply proposed before a colleague answered is refused with 409 already_replied, never forced. */
export interface WaitingThread {
  id: string; subject: string; mailbox: string; fromEmail: string; fromName: string;
  lastAt: string | null; snippet: string; newestMessageId: string | null; assignedToMe: boolean;
}

type WaitingRow = {
  id: string; subject: string | null; mailbox_address: string | null; counterparty_email: string | null; counterparty_name: string | null;
  last_message_at: string | null; last_snippet: string | null; assigned_to_user_id: number | null; newest_message_id: string | null;
};

/** A waiting-thread row in the shape above (pure, tested). The snippet is capped at 240 characters. */
export function waitingThread(r: WaitingRow, me: number): WaitingThread {
  return {
    id: String(r.id), subject: r.subject?.trim() || "(no subject)", mailbox: (r.mailbox_address ?? "").toLowerCase(),
    fromEmail: (r.counterparty_email ?? "").toLowerCase(), fromName: r.counterparty_name?.trim() ?? "",
    lastAt: r.last_message_at ?? null, snippet: (r.last_snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
    newestMessageId: r.newest_message_id ?? null, assignedToMe: r.assigned_to_user_id === me,
  };
}

const app = new Hono<{ Bindings: ContsEnv; Variables: Vars }>();

app.post("/", caller, companyContext as unknown as MiddlewareHandler<{ Bindings: ContsEnv; Variables: Vars }>, async (c) => {
  const me = c.get("mailWaitingUserId");
  // The same count as GET /api/mail-center/waiting-count (routes/mail-reply-guard.ts).
  const where = `t.status = 'open' AND t.trashed_at IS NULL AND t.last_direction = 'inbound'${activeCompanySql(c, "t.company_id")}
        AND (t.assigned_to_user_id = ?
             OR (t.assigned_to_user_id IS NULL AND lower(t.mailbox_address) IN (
                 SELECT lower(a.address) FROM email_addresses a
                  WHERE a.assigned_user_id = ? AND a.active = 1${activeCompanySql(c, "a.company_id")})))`;
  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM email_threads t WHERE ${where}`)
    .bind(me, me)
    .first<{ n: number | string }>();
  c.header("Cache-Control", "no-store");
  const count = Number(row?.n ?? 0);
  // `?list=1` (AI Connector round 4b): also the threads themselves, longest waiting first, the same ones counted. Still a
  // read: nothing is marked read, assigned or written.
  if (c.req.query("list") !== "1" || count === 0) return c.json({ count, opened: true, ...(c.req.query("list") === "1" ? { threads: [] } : {}) });
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.subject, t.mailbox_address, t.counterparty_email, t.counterparty_name, t.last_message_at, t.last_snippet,
            t.assigned_to_user_id,
            (SELECT m.id FROM email_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS newest_message_id
       FROM email_threads t WHERE ${where}
      ORDER BY t.last_message_at ASC LIMIT ${WAITING_LIST_LIMIT}`,
  )
    .bind(me, me)
    .all<WaitingRow>();
  return c.json({ count, opened: true, threads: rows.results.map((r) => waitingThread(r, me)) });
});

export default app;
