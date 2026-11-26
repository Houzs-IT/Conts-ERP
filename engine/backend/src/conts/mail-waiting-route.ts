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
// unassigned in their own mailbox).
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

const app = new Hono<{ Bindings: ContsEnv; Variables: Vars }>();

app.post("/", caller, companyContext as unknown as MiddlewareHandler<{ Bindings: ContsEnv; Variables: Vars }>, async (c) => {
  const me = c.get("mailWaitingUserId");
  // The same count as GET /api/mail-center/waiting-count (routes/mail-reply-guard.ts).
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
  c.header("Cache-Control", "no-store");
  return c.json({ count: Number(row?.n ?? 0), opened: true });
});

export default app;
