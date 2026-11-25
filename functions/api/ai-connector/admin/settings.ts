import { type Env, audit, fail, json } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { actionsEnabled, mcpActionsReady, setActionsEnabled } from '../../../_lib/mcpStore';

/** POST /api/ai-connector/admin/settings { actionsEnabled: boolean }: management's switch "Allow AI actions (meetings,
 *  email)" (owner, 26 Nov 2026; default off). On: a connected AI app may propose a meeting or an email, and do it only
 *  after the person confirms it in the chat (functions/_lib/mcpActions.ts). Off: proposals and confirmations are refused. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ actionsEnabled?: unknown }>().catch(() => null);
  if (typeof body?.actionsEnabled !== 'boolean') return fail('VALIDATION', 'Say whether AI actions are allowed.', 422);
  if (body.actionsEnabled && !(await mcpActionsReady(env))) {
    return fail('NOT_CONFIGURED', 'AI actions are not set up on this system yet: their database update (migration 0380) has not been applied.', 503);
  }
  const before = await actionsEnabled(env);
  await setActionsEnabled(env, body.actionsEnabled);
  await audit(env, { ...actorOf(session), action: 'ai_connector.actions', entityTable: 'settings', entityId: 'mcp.actionsEnabled', before: { actionsEnabled: before }, after: { actionsEnabled: body.actionsEnabled } });
  return json({ ok: true, actionsEnabled: body.actionsEnabled });
};
