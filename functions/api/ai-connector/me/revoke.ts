import { type Env, audit, fail, json } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { revokeToken } from '../../../_lib/mcpStore';

/** POST /api/ai-connector/me/revoke { tokenId }: the signed-in person disconnects one of their own AI apps. revokeToken
 *  is limited to session.userId, so nobody can cut someone else's connection by guessing an id. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, false);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ tokenId?: unknown }>().catch(() => null);
  if (!body || typeof body.tokenId !== 'string' || !body.tokenId) return fail('VALIDATION', 'Choose the connection to disconnect.', 422);
  const revoked = await revokeToken(env, body.tokenId, session.userId);
  if (revoked) await audit(env, { ...actorOf(session), action: 'ai_connector.disconnect_own', entityTable: 'mcp_tokens', entityId: body.tokenId });
  return json({ ok: true, revoked });
};
