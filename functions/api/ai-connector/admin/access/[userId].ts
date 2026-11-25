import { type Env, audit, json, run } from '../../../../_lib/db';
import { actorOf, connectorGate } from '../../../../_lib/aiConnector';
import { revokeUserTokens } from '../../../../_lib/mcpStore';

/** DELETE /api/ai-connector/admin/access/:userId: management takes the AI Connector away from someone. Every AI app
 *  they connected stops working at once (their tokens are revoked). */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const { session } = gate;
  const userId = String(params.userId);
  await run(env, 'DELETE FROM mcp_access WHERE user_id = ?', userId);
  const revoked = await revokeUserTokens(env, userId);
  await audit(env, { ...actorOf(session), action: 'ai_connector.remove', entityTable: 'users', entityId: userId, after: { connectionsCut: revoked } });
  return json({ ok: true, revoked });
};
