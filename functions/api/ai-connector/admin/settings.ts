import { type Env, audit, fail, json } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { actionsEnabled, mcpActionsReady, setActionsEnabled, setWriteSwitch, writeKindsReady, writeSwitches } from '../../../_lib/mcpStore';
import { WRITE_ACTIONS, writeSettingKey, type WriteAction } from '../../../_lib/mcpWrite';

/** POST /api/ai-connector/admin/settings, management only:
 *  { actionsEnabled: boolean }  the main switch "Allow AI actions (meetings, email)" (owner, 26 Nov 2026; default off).
 *                               On: a connected AI app may propose a meeting or an email, and do it only after the
 *                               person confirms it in the chat (functions/_lib/mcpActions.ts). Off: every proposal and
 *                               confirmation is refused, the write actions below included.
 *  { action, enabled }          round 4b: one write action's own switch (action = mail_reply | note; default off),
 *                               effective only while the main switch is on (functions/_lib/mcpWrite.ts). Needs
 *                               migration 0396. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ actionsEnabled?: unknown; action?: unknown; enabled?: unknown }>().catch(() => null);
  if (body && body.action !== undefined) {
    if (!(WRITE_ACTIONS as readonly unknown[]).includes(body.action)) return fail('VALIDATION', `Say which AI action: ${WRITE_ACTIONS.join(' or ')}.`, 422);
    if (typeof body.enabled !== 'boolean') return fail('VALIDATION', 'Say whether that AI action is allowed.', 422);
    const action = body.action as WriteAction;
    if (body.enabled && !(await writeKindsReady(env))) {
      return fail('NOT_CONFIGURED', 'This AI action is not set up on this system yet: its database update (migration 0396) has not been applied.', 503);
    }
    const before = (await writeSwitches(env))[action];
    await setWriteSwitch(env, action, body.enabled);
    await audit(env, { ...actorOf(session), action: 'ai_connector.write_action', entityTable: 'settings', entityId: writeSettingKey(action), before: { [action]: before }, after: { [action]: body.enabled } });
    return json({ ok: true, writeActions: await writeSwitches(env) });
  }
  if (typeof body?.actionsEnabled !== 'boolean') return fail('VALIDATION', 'Say whether AI actions are allowed.', 422);
  if (body.actionsEnabled && !(await mcpActionsReady(env))) {
    return fail('NOT_CONFIGURED', 'AI actions are not set up on this system yet: their database update (migration 0380) has not been applied.', 503);
  }
  const before = await actionsEnabled(env);
  await setActionsEnabled(env, body.actionsEnabled);
  await audit(env, { ...actorOf(session), action: 'ai_connector.actions', entityTable: 'settings', entityId: 'mcp.actionsEnabled', before: { actionsEnabled: before }, after: { actionsEnabled: body.actionsEnabled } });
  return json({ ok: true, actionsEnabled: body.actionsEnabled });
};
