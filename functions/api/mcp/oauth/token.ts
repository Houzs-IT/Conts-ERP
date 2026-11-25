import { type Env, json, one } from '../../../_lib/db';
import { consumeCode, getClient, hasMcpAccess, isDeskRole, issueTokens, mcpReady, refreshTokens, revokeToken } from '../../../_lib/mcpStore';
import { pkceS256 } from '../../../_lib/mcpAccess';

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };
const err = (error: string, description: string, status = 400) => json({ error, error_description: description }, status, NO_STORE);

/** The form fields of a token request, sent as a form (the OAuth standard) or as JSON. */
async function fieldsOf(request: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      for (const [k, v] of Object.entries(await request.json<Record<string, unknown>>())) if (typeof v === 'string') out[k] = v;
    } else {
      for (const [k, v] of new URLSearchParams(await request.text())) out[k] = v;
    }
  } catch { /* an empty or broken body is answered as a missing field below */ }
  return out;
}

/**
 * POST /api/mcp/oauth/token: the AI app trades the one-time code (with its PKCE verifier) for a 24-hour access token
 * and a 90-day refresh token, or a refresh token for a new pair (the old one stops working). Only SHA-256 hashes are
 * stored. Each time, the person must still be active, a desk account, and allowed to use the AI Connector.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await mcpReady(env))) return err('temporarily_unavailable', 'The AI Connector is not set up on this system yet.', 503);
  const f = await fieldsOf(request);
  const clientId = f.client_id ?? '';
  if (!clientId || !(await getClient(env, clientId))) return err('invalid_client', 'Unknown client', 401);

  let issued: Awaited<ReturnType<typeof issueTokens>>;
  let userId: string;
  if (f.grant_type === 'authorization_code') {
    if (!f.code || !f.code_verifier) return err('invalid_request', 'code and code_verifier are required');
    const rec = await consumeCode(env, f.code);
    if (!rec || rec.clientId !== clientId) return err('invalid_grant', 'The code is invalid, used or expired');
    if (f.redirect_uri && f.redirect_uri !== rec.redirectUri) return err('invalid_grant', 'redirect_uri does not match');
    if ((await pkceS256(f.code_verifier)) !== rec.codeChallenge) return err('invalid_grant', 'PKCE check failed');
    userId = rec.userId;
    issued = await issueTokens(env, userId, clientId);
  } else if (f.grant_type === 'refresh_token') {
    if (!f.refresh_token) return err('invalid_request', 'refresh_token is required');
    const r = await refreshTokens(env, f.refresh_token, clientId);
    if (!r) return err('invalid_grant', 'The refresh token is invalid, revoked or expired');
    userId = r.userId;
    issued = r;
  } else {
    return err('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }
  const u = await one<{ id: string; role: string; is_active: number }>(env, 'SELECT id, role, is_active FROM users WHERE id = ?', userId);
  if (!u || Number(u.is_active) !== 1 || !isDeskRole(u.role) || !(await hasMcpAccess(env, u))) {
    await revokeToken(env, issued.tokenId, null);
    return err('invalid_grant', 'This account may not use the AI Connector');
  }
  return json({ access_token: issued.accessToken, token_type: 'Bearer', expires_in: issued.expiresIn, refresh_token: issued.refreshToken, scope: 'erp.read' }, 200, NO_STORE);
};
