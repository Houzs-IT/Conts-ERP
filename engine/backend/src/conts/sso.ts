// Conts only (not part of Houzs's code): single sign-on from Property OS.
//
// Property OS already knows who is signed in. Its server asks this endpoint for an engine session on that
// person's behalf, proving the request is its own with an HMAC over a short-lived assertion. The browser
// never sees the shared secret, and nobody types a second password. The person's engine account is found
// by email and created on first use, so staff are managed in one place: Property OS.
import { Hono } from "hono";
import type { Env } from "../types";
import { createSession, mintSessionPass } from "../services/auth";
import { type ContsAccess, parseContsAccess, isFullEverywhere, hasAnyAccess, contsPermissions, contsRoleName, saveContsRoleAccess } from "./access";

type ContsEnv = Env & { CONTS_SSO_SECRET?: string };
interface Assertion { email: string; name: string; role: string; exp: number; access?: unknown }

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

/** The engine role for a Property OS role. Full in every area gets the full-access role, as before the
 *  Permissions chart existed; anything less gets that role's own engine role, whose permission keys and
 *  page access are rewritten from the chart at every sign-on. Field roles and owners never reach here:
 *  Property OS refuses them, and they are refused again below. */
const OFFICE = new Set(["management", "finance_admin", "operations_manager", "operations_staff"]);

async function roleIdFor(env: Env, contsRole: string, access: ContsAccess): Promise<number | null> {
  if (!OFFICE.has(contsRole) || !hasAnyAccess(access)) return null;
  if (isFullEverywhere(access)) {
    const full = () => env.DB.prepare(`SELECT id FROM roles WHERE permissions LIKE '%"*"%' ORDER BY id LIMIT 1`).first<{ id: number }>();
    const r = await full();
    if (r) return r.id;
    // A new instance has no roles at all (production's first sign-on was refused for this, 8 Oct 2026):
    // the full-access role is made here, named as Houzs names it.
    await env.DB.prepare(`INSERT INTO roles (name, description, permissions, is_system, scope_to_pic) VALUES (?, ?, ?, 1, 0)`)
      .bind("Owner", "Full access, for accounts with Full in every area of Property OS", JSON.stringify(["*"])).run();
    return (await full())?.id ?? null;
  }
  const name = contsRoleName(contsRole);
  const permissions = JSON.stringify(contsPermissions(access));
  const found = await env.DB.prepare(`SELECT id, permissions FROM roles WHERE name = ?`).bind(name).first<{ id: number; permissions: string }>();
  if (!found) {
    await env.DB.prepare(`INSERT INTO roles (name, description, permissions, is_system, scope_to_pic) VALUES (?, ?, ?, 0, 0)`)
      .bind(name, "Set from the Permissions chart in Property OS", permissions).run();
  } else if (found.permissions !== permissions) {
    await env.DB.prepare(`UPDATE roles SET permissions = ? WHERE id = ?`).bind(permissions, found.id).run();
  }
  await saveContsRoleAccess(env, name, access);
  return found?.id ?? (await env.DB.prepare(`SELECT id FROM roles WHERE name = ?`).bind(name).first<{ id: number }>())?.id ?? null;
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
  const access = parseContsAccess(a.access);
  if (!access) return c.json({ error: "Sign-in did not say what this account may open." }, 401);
  const roleId = await roleIdFor(c.env, a.role, access);
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
