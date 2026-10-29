// Conts only (not part of Houzs's code): single sign-on from Property OS.
//
// Property OS already knows who is signed in. Its server asks this endpoint for an engine session on that
// person's behalf, proving the request is its own with an HMAC over a short-lived assertion. The browser
// never sees the shared secret, and nobody types a second password. The person's engine account is found
// by email and created on first use, so staff are managed in one place: Property OS.
import { Hono } from "hono";
import type { Env } from "../types";
import { createSession, mintSessionPass } from "../services/auth";
import { type ContsAccess, LEDGER_AREA, parseContsAccess, isFullEverywhere, hasAnyAccess, contsPermissions, contsRoleName, saveContsRoleAccess } from "./access";
import { ledgerPermissions } from "./ledger-access";

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

/** The engine role for a Property OS account. Full in every area gets the full-access role, as before the
 *  Permissions chart existed; anything less gets an engine role named after a fingerprint of its access levels
 *  ("Conts: staff 3f9a1b2c"), so people with the same access share a role and people with different access never
 *  do. Access is per department, position and person now, so a role named after the Conts role alone would have
 *  its keys rewritten by whoever signed on last. Field roles and owners never reach here: Property OS refuses
 *  them, and they are refused again below. */
const OFFICE = new Set(["management", "finance_admin", "operations_manager", "operations_staff"]);

/** The first 8 hex characters of a SHA-256 over the levels, area names sorted so the order they arrive in
 *  never matters. */
export async function accessFingerprint(access: ContsAccess): Promise<string> {
  const text = JSON.stringify(Object.keys(access).sort().map((k) => [k, access[k]]));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Writes a Conts role's permission keys, creating the role the first time. */
async function upsertRole(env: Env, name: string, description: string, permissions: string): Promise<number | null> {
  const found = await env.DB.prepare(`SELECT id, permissions FROM roles WHERE name = ?`).bind(name).first<{ id: number; permissions: string }>();
  if (!found) {
    await env.DB.prepare(`INSERT INTO roles (name, description, permissions, is_system, scope_to_pic) VALUES (?, ?, ?, 0, 0)`)
      .bind(name, description, permissions).run();
  } else if (found.permissions !== permissions) {
    await env.DB.prepare(`UPDATE roles SET permissions = ? WHERE id = ?`).bind(permissions, found.id).run();
  }
  return found?.id ?? (await env.DB.prepare(`SELECT id FROM roles WHERE name = ?`).bind(name).first<{ id: number }>())?.id ?? null;
}

export async function roleIdFor(env: Env, contsRole: string, access: ContsAccess): Promise<number | null> {
  if (!OFFICE.has(contsRole) || !hasAnyAccess(access)) return null;
  if (isFullEverywhere(access)) {
    // The Conts ledger roles below hold "*" too; the full-access role is the one that is not one of them.
    const full = () => env.DB.prepare(`SELECT id FROM roles WHERE permissions LIKE '%"*"%' AND name NOT LIKE 'Conts: %' ORDER BY id LIMIT 1`).first<{ id: number }>();
    let r = await full();
    if (!r) {
      // A new instance has no roles at all (production's first sign-on was refused for this, 8 Oct 2026):
      // the full-access role is made here, named as Houzs names it.
      await env.DB.prepare(`INSERT INTO roles (name, description, permissions, is_system, scope_to_pic) VALUES (?, ?, ?, 1, 0)`)
        .bind("Owner", "Full access, for accounts with Full in every area of Property OS", JSON.stringify(["*"])).run();
      r = await full();
    }
    const ledger = access[LEDGER_AREA] ?? "none";
    if (!r || ledger === "none") return r?.id ?? null;
    // Full everywhere with the Ledger: the full-access role's own keys plus the ledger's, one role per
    // ledger level so two people at different levels never rewrite one shared role.
    const base = await env.DB.prepare(`SELECT permissions FROM roles WHERE id = ?`).bind(r.id).first<{ permissions: string }>();
    let keys: string[] = [];
    try { keys = JSON.parse(base?.permissions ?? "[]") as string[]; } catch { keys = []; }
    if (!keys.includes("*")) keys = ["*", ...keys];
    const permissions = JSON.stringify([...new Set([...keys, ...ledgerPermissions(ledger)])]);
    return upsertRole(env, contsRoleName(`full + ledger ${ledger}`), "Full access plus the ledger, set from the Permissions chart in Property OS", permissions);
  }
  const name = contsRoleName(`staff ${await accessFingerprint(access)}`);
  const permissions = JSON.stringify(contsPermissions(access));
  const id = await upsertRole(env, name, "Set from the Permissions chart in Property OS", permissions);
  await saveContsRoleAccess(env, name, access);
  return id;
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
