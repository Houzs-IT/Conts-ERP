import { type Env, audit, fail, json, nowIso, one, run } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { isDeskRole, isMcpAdmin } from '../../../_lib/mcpStore';

/** POST /api/ai-connector/admin/access { userId }: management turns the AI Connector on for a desk account without
 *  waiting for a request (any request of theirs still waiting is marked approved). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ userId?: unknown }>().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return fail('VALIDATION', 'Choose a staff member.', 422);
  const u = await one<{ id: string; full_name: string; role: string; is_active: number }>(env, 'SELECT id, full_name, role, is_active FROM users WHERE id = ?', userId);
  if (!u || Number(u.is_active) !== 1) return fail('NOT_FOUND', 'That account was not found or is switched off.', 404);
  if (!isDeskRole(u.role)) return fail('VALIDATION', 'Owners and field accounts cannot use the AI Connector.', 422);
  if (isMcpAdmin(u)) return json({ ok: true, alreadyAllowed: true });
  const now = nowIso();
  await run(env, 'INSERT INTO mcp_access (user_id, approved_by, approved_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING', userId, session.userId, now);
  await run(env, `UPDATE mcp_access_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE user_id = ? AND status = 'pending'`, session.userId, now, userId);
  await audit(env, { ...actorOf(session), action: 'ai_connector.grant', entityTable: 'users', entityId: userId, after: { name: u.full_name } });
  return json({ ok: true });
};
