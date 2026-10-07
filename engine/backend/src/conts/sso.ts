// Conts only (not part of Houzs's code): single sign-on from Property OS.
//
// Property OS already knows who is signed in. Its server asks this endpoint for an engine session on that
// person's behalf, proving the request is its own with an HMAC over a short-lived assertion. The browser
// never sees the shared secret, and nobody types a second password. The person's engine account is found
// by email and created on first use, so staff are managed in one place: Property OS.
import { Hono } from "hono";
import type { Env } from "../types";
import { createSession, mintSessionPass } from "../services/auth";

type ContsEnv = Env & { CONTS_SSO_SECRET?: string };
interface Assertion { email: string; name: string; role: string; exp: number }

const MAX_AGE_MS = 60_000;
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function verify(secret: string, token: string): Promise<Assertion | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", key, fromB64url(sig), new TextEncoder().encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const a = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Assertion;
    if (!a.email || typeof a.exp !== "number" || a.exp < Date.now() || a.exp > Date.now() + MAX_AGE_MS) return null;
    return a;
  } catch { return null; }
}

/** Property OS roles that may use supply chain, and the engine role each gets. Management, finance and
 *  operations managers get the full-access role; operations staff get supply chain without the rest.
 *  Field roles and owners are refused by Property OS before it ever calls here, and again here. */
const FULL = new Set(["management", "finance_admin", "operations_manager"]);
const LIMITED = new Set(["operations_staff"]);

async function roleIdFor(env: Env, contsRole: string): Promise<number | null> {
  if (FULL.has(contsRole)) {
    const r = await env.DB.prepare(`SELECT id FROM roles WHERE permissions LIKE '%"*"%' ORDER BY id LIMIT 1`).first<{ id: number }>();
    return r?.id ?? null;
  }
  if (!LIMITED.has(contsRole)) return null;
  const found = await env.DB.prepare(`SELECT id FROM roles WHERE name = ?`).bind("Supply Chain").first<{ id: number }>();
  if (found) return found.id;
  await env.DB.prepare(`INSERT INTO roles (name, description, permissions, is_system, scope_to_pic) VALUES (?, ?, ?, 0, 0)`)
    .bind("Supply Chain", "Supply chain screens, signed in from Property OS", JSON.stringify(["scm.access"])).run();
  return (await env.DB.prepare(`SELECT id FROM roles WHERE name = ?`).bind("Supply Chain").first<{ id: number }>())?.id ?? null;
}

const app = new Hono<{ Bindings: ContsEnv }>();

/** POST /api/conts-sso { assertion } -> { token, session_pass? }. Server to server only. */
app.post("/", async (c) => {
  const secret = c.env.CONTS_SSO_SECRET;
  if (!secret || secret.length < 32) return c.json({ error: "Single sign-on is not set up." }, 503);
  const body = await c.req.json<{ assertion?: string }>().catch(() => null);
  const a = body?.assertion ? await verify(secret, body.assertion) : null;
  if (!a) return c.json({ error: "Sign-in could not be verified." }, 401);

  const email = a.email.toLowerCase().trim();
  const roleId = await roleIdFor(c.env, a.role);
  if (!roleId) return c.json({ error: "This account does not have access to supply chain." }, 403);

  let user = await c.env.DB.prepare(`SELECT id, status, role_id FROM users WHERE email = ?`).bind(email).first<{ id: number; status: string; role_id: number }>();
  if (!user) {
    await c.env.DB.prepare(`INSERT INTO users (email, name, role_id, status) VALUES (?, ?, ?, 'active')`).bind(email, a.name || email, roleId).run();
    user = await c.env.DB.prepare(`SELECT id, status, role_id FROM users WHERE email = ?`).bind(email).first<{ id: number; status: string; role_id: number }>();
  } else if (user.role_id !== roleId) {
    // The role follows Property OS: a promotion or demotion there applies here at the next sign-in.
    await c.env.DB.prepare(`UPDATE users SET role_id = ? WHERE id = ?`).bind(roleId, user.id).run();
  }
  if (!user) return c.json({ error: "The account could not be prepared." }, 500);
  if (user.status !== "active") return c.json({ error: "Account is disabled" }, 403);

  await c.env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).bind(user.id).run();
  const token = await createSession(c.env, user.id);
  const sessionPass = await mintSessionPass(c.env, token, Date.now());
  return c.json({ token, ...(sessionPass ? { session_pass: sessionPass } : {}) });
});

export default app;
