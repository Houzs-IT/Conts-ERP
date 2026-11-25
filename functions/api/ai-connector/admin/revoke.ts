import { type Env, audit, fail, json } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { revokeToken, revokeUserTokens } from '../../../_lib/mcpStore';

/** POST /api/ai-connector/admin/revoke { tokenId } or { userId }: management disconnects one AI app, or every AI app
 *  of one person. Their access stays on (they can connect again); Remove on the allowed list takes it away. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ tokenId?: unknown; userId?: unknown }>().catch(() => null);
  let revoked = 0;
  let entity: { table: string; id: string };
  if (typeof body?.tokenId === 'string' && body.tokenId) { revoked = await revokeToken(env, body.tokenId, null); entity = { table: 'mcp_tokens', id: body.tokenId }; }
  else if (typeof body?.userId === 'string' && body.userId) { revoked = await revokeUserTokens(env, body.userId); entity = { table: 'users', id: body.userId }; }
  else return fail('VALIDATION', 'Choose the connection to disconnect.', 422);
  await audit(env, { ...actorOf(session), action: 'ai_connector.disconnect', entityTable: entity.table, entityId: entity.id, after: { revoked } });
  return json({ ok: true, revoked });
};
