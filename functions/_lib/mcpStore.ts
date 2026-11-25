/**
 * AI Connector storage (migration 0378_mcp_connector.sql): who may connect, the AI apps registered with OAuth, the
 * pending "Allow?" screens, one-time codes, tokens and the log of every lookup. Tokens and codes are stored as SHA-256
 * hashes only; the values themselves leave the server once, in the OAuth reply.
 *
 * Owner, 25 Nov 2026: every company system gets the AI Connector Hookka and Houzs have. Staff connect Claude or
 * ChatGPT with their own login, read-only, seeing only what that login sees; management approves each person, sees
 * every lookup and can disconnect anyone.
 *
 * Migrations are applied by hand here (Apply migrations to production), so until 0378 is in, mcpReady() is false and
 * every connector endpoint says so instead of failing; nothing else in the app reads these tables.
 */
import { type Env, all, one, run, nowIso } from './db';
import { hasColumn } from './auth';

export const MCP_TOKEN_PREFIX = 'ctmcp_';
export const MCP_REFRESH_PREFIX = 'ctmcpr_';
export const ACCESS_TTL_MS = 24 * 3600_000;
export const REFRESH_TTL_MS = 90 * 24 * 3600_000;
export const CODE_TTL_MS = 10 * 60_000;
/** The leak check's own client: its tokens are short-lived, revoked when the check ends, and left off the lists. */
export const LEAK_CLIENT_ID = 'mcpc_leak_check';

/** Whether migration 0378 has been applied (remembered by hasColumn; a missing table is looked for again after a minute). */
export const mcpReady = (env: Env) => hasColumn(env, 'mcp_calls', 'id');

/** The AI Connector admins: management (the owner's own department kind, Full everywhere in access.ts). */
export const isMcpAdmin = (who: { role: string }) => who.role === 'management';
/** Desk accounts only: owners, cleaners, technicians and Renovation staff have their own apps and no desk API. */
export const isDeskRole = (role: string) => !['owner', 'housekeeper', 'technician', 'renovator'].includes(role);

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

const later = (ms: number) => new Date(Date.now() + ms).toISOString();

/* ---------- who may connect ---------- */

/** Admins always may; anyone else needs an approval (mcp_access). */
export async function hasMcpAccess(env: Env, user: { id: string; role: string }): Promise<boolean> {
  if (isMcpAdmin(user)) return true;
  return !!(await one(env, 'SELECT user_id FROM mcp_access WHERE user_id = ?', user.id));
}

/* ---------- AI apps (OAuth dynamic client registration) ---------- */

export interface McpClient { clientId: string; clientName: string; redirectUris: string[] }

export async function getClient(env: Env, clientId: string): Promise<McpClient | null> {
  const r = await one<{ client_id: string; client_name: string | null; redirect_uris: string }>(env,
    'SELECT client_id, client_name, redirect_uris FROM mcp_oauth_clients WHERE client_id = ?', clientId);
  if (!r) return null;
  let uris: string[] = [];
  try { const parsed = JSON.parse(r.redirect_uris); if (Array.isArray(parsed)) uris = parsed.map(String); } catch { uris = []; }
  return { clientId: r.client_id, clientName: r.client_name || 'AI app', redirectUris: uris };
}

export async function registerClient(env: Env, name: string, redirectUris: string[]): Promise<McpClient> {
  const clientId = `mcpc_${randomToken(18)}`;
  const clientName = (name || 'AI app').slice(0, 80);
  await run(env, 'INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
    clientId, clientName, JSON.stringify(redirectUris), nowIso());
  return { clientId, clientName, redirectUris };
}

/* ---------- pending "Allow?" screens ---------- */

export interface AuthRequest { id: string; clientId: string; redirectUri: string; state: string; codeChallenge: string }
type AuthRow = { id: string; client_id: string; redirect_uri: string; state: string | null; code_challenge: string };
const authOf = (r: AuthRow): AuthRequest => ({ id: r.id, clientId: r.client_id, redirectUri: r.redirect_uri, state: r.state ?? '', codeChallenge: r.code_challenge });

export async function createAuthRequest(env: Env, a: Omit<AuthRequest, 'id'>): Promise<string> {
  const id = `mcpa_${randomToken(18)}`;
  // Old screens nobody answered go when a new one is made, so the table stays small.
  await run(env, 'DELETE FROM mcp_auth_requests WHERE expires_at < ?', nowIso());
  await run(env, 'INSERT INTO mcp_auth_requests (id, client_id, redirect_uri, state, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, a.clientId, a.redirectUri, a.state.slice(0, 500), a.codeChallenge, later(CODE_TTL_MS));
  return id;
}

export async function getAuthRequest(env: Env, id: string): Promise<AuthRequest | null> {
  const r = await one<AuthRow>(env, 'SELECT id, client_id, redirect_uri, state, code_challenge FROM mcp_auth_requests WHERE id = ? AND expires_at > ?', id, nowIso());
  return r ? authOf(r) : null;
}

/** Single use: whoever deletes the row owns the decision. */
export async function takeAuthRequest(env: Env, id: string): Promise<AuthRequest | null> {
  const r = await one<AuthRow>(env, 'DELETE FROM mcp_auth_requests WHERE id = ? AND expires_at > ? RETURNING id, client_id, redirect_uri, state, code_challenge', id, nowIso());
  return r ? authOf(r) : null;
}

/* ---------- one-time authorization codes ---------- */

export async function createCode(env: Env, a: { clientId: string; userId: string; redirectUri: string; codeChallenge: string }): Promise<string> {
  const code = randomToken(32);
  await run(env, 'DELETE FROM mcp_oauth_codes WHERE expires_at < ?', nowIso());
  await run(env, `INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at, used)
    VALUES (?, ?, ?, ?, ?, ?, 0)`, await sha256Hex(code), a.clientId, a.userId, a.redirectUri, a.codeChallenge, later(CODE_TTL_MS));
  return code;
}

/** Single use: the UPDATE claims the code; a replay finds used = 1 and fails. */
export async function consumeCode(env: Env, code: string): Promise<{ clientId: string; userId: string; redirectUri: string; codeChallenge: string } | null> {
  const r = await one<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string }>(env,
    `UPDATE mcp_oauth_codes SET used = 1 WHERE code_hash = ? AND used = 0 AND expires_at > ?
     RETURNING client_id, user_id, redirect_uri, code_challenge`, await sha256Hex(code), nowIso());
  return r ? { clientId: r.client_id, userId: r.user_id, redirectUri: r.redirect_uri, codeChallenge: r.code_challenge } : null;
}

/* ---------- tokens ---------- */

export interface IssuedTokens { accessToken: string; refreshToken: string; expiresIn: number; tokenId: string }

export async function issueTokens(env: Env, userId: string, clientId: string, accessTtlMs = ACCESS_TTL_MS): Promise<IssuedTokens> {
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const refreshToken = MCP_REFRESH_PREFIX + randomToken(32);
  const tokenId = `mcpt_${randomToken(12)}`;
  await run(env, `INSERT INTO mcp_tokens (id, user_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  tokenId, userId, clientId, await sha256Hex(accessToken), later(accessTtlMs), await sha256Hex(refreshToken), later(REFRESH_TTL_MS), nowIso());
  return { accessToken, refreshToken, expiresIn: Math.floor(accessTtlMs / 1000), tokenId };
}

/** Rotates: the old refresh token stops working the moment the new pair is issued. */
export async function refreshTokens(env: Env, refreshToken: string, clientId: string): Promise<(IssuedTokens & { userId: string }) | null> {
  if (!refreshToken.startsWith(MCP_REFRESH_PREFIX)) return null;
  const h = await sha256Hex(refreshToken);
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const newRefresh = MCP_REFRESH_PREFIX + randomToken(32);
  const r = await one<{ id: string; user_id: string }>(env,
    `UPDATE mcp_tokens SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?
      WHERE refresh_hash = ? AND client_id = ? AND revoked_at IS NULL AND refresh_expires_at > ?
      RETURNING id, user_id`,
    await sha256Hex(accessToken), later(ACCESS_TTL_MS), await sha256Hex(newRefresh), later(REFRESH_TTL_MS), h, clientId, nowIso());
  if (!r) return null;
  return { accessToken, refreshToken: newRefresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), tokenId: r.id, userId: r.user_id };
}

/** The person behind an access token, when the token is live and the person may still use the connector: active,
 *  a desk account, and an admin or approved. One query. Null for anything else, including a database without 0378. */
export interface McpIdentity { tokenId: string; clientId: string; user: { id: string; email: string; fullName: string; role: string } }
export async function resolveAccessToken(env: Env, token: string): Promise<McpIdentity | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length > 200) return null;
  try {
    if (!(await mcpReady(env))) return null;
    const r = await one<{ id: string; client_id: string; last_used_at: string | null; user_id: string; email: string; full_name: string; role: string; is_active: number; approved: boolean }>(env,
      `SELECT t.id, t.client_id, t.last_used_at, u.id AS user_id, u.email, u.full_name, u.role, u.is_active,
              EXISTS (SELECT 1 FROM mcp_access a WHERE a.user_id = u.id) AS approved
         FROM mcp_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.access_hash = ? AND t.revoked_at IS NULL AND t.access_expires_at > ?`, await sha256Hex(token), nowIso());
    if (!r || Number(r.is_active) !== 1 || !isDeskRole(r.role)) return null;
    if (!isMcpAdmin(r) && !r.approved) return null;
    // When it was last used, for the admin page: written at most once a minute per token.
    if (!r.last_used_at || Date.now() - Date.parse(r.last_used_at) > 60_000) {
      await run(env, 'UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?', nowIso(), r.id).catch(() => { /* cosmetic */ });
    }
    return { tokenId: r.id, clientId: r.client_id, user: { id: r.user_id, email: r.email, fullName: r.full_name, role: r.role } };
  } catch (e) {
    console.error('AI Connector token check failed', e);
    return null;
  }
}

/** Revokes one token; `userId` limits it to that person's own (null: an admin, any token). Returns how many. */
export async function revokeToken(env: Env, tokenId: string, userId: string | null): Promise<number> {
  const rows = await all(env, `UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL ${userId === null ? '' : 'AND user_id = ?'} RETURNING id`,
    nowIso(), tokenId, ...(userId === null ? [] : [userId]));
  return rows.length;
}

export async function revokeUserTokens(env: Env, userId: string): Promise<number> {
  return (await all(env, 'UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL RETURNING id', nowIso(), userId)).length;
}

/* ---------- the lookup log ---------- */

export interface CallLog { tokenId: string; userId: string; clientId: string; tool: string; target: string; status: number; ok: boolean; note: string; ms: number }

/** One row per tool call. Never throws: a failed log line must not fail the answer. */
export async function logCall(env: Env, c: CallLog): Promise<void> {
  try {
    await run(env, `INSERT INTO mcp_calls (id, token_id, user_id, client_id, tool, target, status, ok, note, ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `mcpl_${randomToken(12)}`, c.tokenId, c.userId, c.clientId, c.tool.slice(0, 60), c.target.slice(0, 500), c.status, c.ok ? 1 : 0, c.note.slice(0, 300), c.ms, nowIso());
  } catch (e) {
    console.error('AI Connector call log failed', e);
  }
}
