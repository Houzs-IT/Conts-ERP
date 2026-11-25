import { type Env, all, json, nowIso, one } from '../../_lib/db';
import { connectorGate, connectorUrl } from '../../_lib/aiConnector';
import { appLabel } from '../../_lib/mcpAccess';
import { hasMcpAccess, isMcpAdmin, LEAK_CLIENT_ID } from '../../_lib/mcpStore';

/** GET /api/ai-connector/me: the signed-in person's own AI Connector: whether it is on for them, a request waiting,
 *  the connector address and the AI apps they have connected. Only their own rows (session.userId). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, false);
  if (gate.response) return gate.response;
  const { session } = gate;
  const me = { id: session.userId, role: session.role };
  const [allowed, pending, apps] = await Promise.all([
    hasMcpAccess(env, me),
    one<{ id: string; created_at: string }>(env, `SELECT id, created_at FROM mcp_access_requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, session.userId),
    all<{ id: string; created_at: string; last_used_at: string | null; client_name: string | null }>(env, `
      SELECT t.id, t.created_at, t.last_used_at, c.client_name
        FROM mcp_tokens t LEFT JOIN mcp_oauth_clients c ON c.client_id = t.client_id
       WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.refresh_expires_at > ? AND t.client_id <> ?
       ORDER BY t.created_at DESC`, session.userId, nowIso(), LEAK_CLIENT_ID),
  ]);
  return json({
    allowed,
    isAdmin: isMcpAdmin(me),
    pendingRequest: pending ? { id: pending.id, createdAt: pending.created_at } : null,
    connectorUrl: connectorUrl(request),
    apps: apps.map(a => ({ tokenId: a.id, app: appLabel(a.client_name ?? ''), connectedAt: a.created_at, lastUsedAt: a.last_used_at })),
  });
};
