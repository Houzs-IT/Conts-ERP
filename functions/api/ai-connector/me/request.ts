import { type Env, audit, json, nowIso, one, run } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { hasMcpAccess, randomToken } from '../../../_lib/mcpStore';
import { notifyUsers } from '../../../_lib/notify';

/** POST /api/ai-connector/me/request { reason? }: the signed-in person asks for the AI Connector. Management gets a
 *  notice in the bell and approves or rejects on System > AI Connector. Only ever for the person asking (session.userId). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, false);
  if (gate.response) return gate.response;
  const { session } = gate;
  if (await hasMcpAccess(env, { id: session.userId, role: session.role })) return json({ ok: true, alreadyAllowed: true });
  const existing = await one(env, `SELECT id FROM mcp_access_requests WHERE user_id = ? AND status = 'pending'`, session.userId);
  if (existing) return json({ ok: true, alreadyRequested: true });
  const body = await request.json<{ reason?: unknown }>().catch(() => ({} as { reason?: unknown }));
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null;
  const id = `mcpr_${randomToken(12)}`;
  await run(env, `INSERT INTO mcp_access_requests (id, user_id, reason, status, created_at) VALUES (?, ?, ?, 'pending', ?)`, id, session.userId, reason, nowIso());
  await audit(env, { ...actorOf(session), action: 'ai_connector.request', entityTable: 'mcp_access_requests', entityId: id, after: { reason } });
  // Never fails the request (notifyUsers records its own failure).
  await notifyUsers(env, { roles: ['management'] }, {
    kind: 'ai_connector.request', title: `${session.fullName || session.email} asked to use the AI Connector`,
    body: 'Approve or reject on System > AI Connector. It gives read-only access to the ERP from Claude or ChatGPT, with their own access.',
    link: '/system/ai-connector', entityTable: 'mcp_access_requests', entityId: id, dedupeKey: `ai-connector-request-${id}`, except: session.userId,
  });
  return json({ ok: true, id });
};
