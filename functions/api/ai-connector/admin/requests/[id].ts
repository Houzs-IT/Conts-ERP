import { type Env, audit, fail, json, nowIso, one, run } from '../../../../_lib/db';
import { actorOf, connectorGate } from '../../../../_lib/aiConnector';

/** POST /api/ai-connector/admin/requests/:id { decision: 'approve' | 'reject' }: management decides one waiting
 *  request. Approve turns the AI Connector on for that person. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ decision?: unknown }>().catch(() => null);
  const decision = body?.decision;
  if (decision !== 'approve' && decision !== 'reject') return fail('VALIDATION', 'Choose Approve or Reject.', 422);
  const now = nowIso();
  const r = await one<{ user_id: string }>(env,
    `UPDATE mcp_access_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending' RETURNING user_id`,
    decision === 'approve' ? 'approved' : 'rejected', session.userId, now, String(params.id));
  if (!r) return fail('NOT_FOUND', 'That request was not found or has already been decided. Refresh the page.', 404);
  if (decision === 'approve') {
    await run(env, 'INSERT INTO mcp_access (user_id, approved_by, approved_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING', r.user_id, session.userId, now);
  }
  await audit(env, { ...actorOf(session), action: `ai_connector.${decision}`, entityTable: 'users', entityId: r.user_id, after: { request: String(params.id) } });
  return json({ ok: true });
};
