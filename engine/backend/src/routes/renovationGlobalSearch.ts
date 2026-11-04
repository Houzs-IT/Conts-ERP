/* Conts only: POST /api/conts-search, the supply chain half of Property OS's top-bar search (owner, 3 Nov 2026).
   Server to server, like /api/conts-sso and /api/claims-forward: Property OS's server sends the words typed with a
   one-minute statement of who is asking and the levels their role holds in each area, signed with the single sign-on
   secret (functions/_lib/scmEngine.ts searchAssertion). No engine session is made. The person's engine account (found
   by email) gives the company scope through the usual companyContext; the levels decide which kinds are searched.
   The reading itself is services/renovation/renovationSearch.ts. */

import { Hono, type MiddlewareHandler } from "hono";
import type { Env } from "../types";
import type { AuthUser } from "../services/auth";
import { companyContext } from "../middleware/companyContext";
import { activeCompanySql, allowedCompaniesSql } from "../scm/lib/companyScope";
import { parseContsAccess, type ContsAccess } from "../conts/access";
import type { Db } from "../services/renovation/load";
import { RENO_SEARCH_KINDS, renovationSearch, type RenoSearchKind } from "../services/renovation/renovationSearch";

type ContsEnv = Env & { CONTS_SSO_SECRET?: string };
type Vars = { contsSearchAccess: ContsAccess };

const MAX_AGE_MS = 60_000;
const enc = new TextEncoder();
const fromB64url = (v: string) => Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

export interface SearchAssertion { email: string; access: ContsAccess }

/** `base64url(JSON).base64url(HMAC-SHA256)` marked aud 'search', so neither a sign-on nor a claims statement passes. */
export async function verifySearchAssertion(secret: string, token: string, now = Date.now()): Promise<SearchAssertion | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(body)))) return null;
    const a = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { aud?: unknown; email?: unknown; exp?: unknown; access?: unknown };
    if (a.aud !== "search" || typeof a.email !== "string" || !a.email || typeof a.exp !== "number") return null;
    if (a.exp < now || a.exp > now + MAX_AGE_MS) return null;
    const access = parseContsAccess(a.access);
    return access ? { email: a.email.trim().toLowerCase(), access } : null;
  } catch {
    return null;
  }
}

/** Who is asking: the statement must verify and name an active engine account. A person who has never opened the
 *  supply chain has no account yet; Property OS signs them on once (which makes it) and asks again. */
const searchCaller: MiddlewareHandler<{ Bindings: ContsEnv; Variables: Vars }> = async (c, next) => {
  const secret = c.env.CONTS_SSO_SECRET;
  if (!secret || secret.length < 32) return c.json({ error: "not_configured", message: "Search is not set up on this server." }, 503);
  const token = c.req.header("x-conts-search");
  const a = token ? await verifySearchAssertion(secret, token) : null;
  if (!a) return c.json({ error: "not_verified", message: "The search request could not be verified." }, 401);
  const user = await c.env.DB.prepare(`SELECT id, status FROM users WHERE lower(email) = ?`).bind(a.email).first<{ id: number; status: string }>();
  if (!user) return c.json({ error: "no_engine_account", message: "No supply chain account yet." }, 409);
  if (user.status !== "active") return c.json({ error: "disabled", message: "This supply chain account is switched off." }, 403);
  /* companyContext reads only the user's id (its user_companies grants). */
  c.set("user", { id: user.id, email: a.email } as unknown as AuthUser);
  c.set("contsSearchAccess", a.access);
  await next();
};

const app = new Hono<{ Bindings: ContsEnv; Variables: Vars }>();

app.post("/", searchCaller, companyContext as unknown as MiddlewareHandler<{ Bindings: ContsEnv; Variables: Vars }>, async (c) => {
  const body = await c.req.json<{ q?: unknown; only?: unknown; limit?: unknown }>().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.slice(0, 80) : "";
  const only = typeof body?.only === "string" && (RENO_SEARCH_KINDS as readonly string[]).includes(body.only) ? (body.only as RenoSearchKind) : null;
  const n = Number(body?.limit);
  const limit = Number.isInteger(n) && n >= 1 && n <= 51 ? n : 6;
  const result = await renovationSearch(c.env.DB as unknown as Db, q, c.get("contsSearchAccess"), {
    active: (col) => activeCompanySql(c, col),
    allowed: (col) => allowedCompaniesSql(c, col),
  }, { only, limit });
  c.header("Cache-Control", "no-store");
  return c.json(result);
});

export default app;
