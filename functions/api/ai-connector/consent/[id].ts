import { type Env, audit, fail, json } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { appLabel } from '../../../_lib/mcpAccess';
import { createCode, getAuthRequest, getClient, hasMcpAccess, takeAuthRequest } from '../../../_lib/mcpStore';

const EXPIRED = 'This connect request has expired. Start again from the AI app.';
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };

/** GET /api/ai-connector/consent/:id: what the "Allow?" screen (/ai-connect) shows: which AI app asks, for whom, and
 *  whether the AI Connector is on for the signed-in person (session.userId). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await connectorGate(request, env, false);
  if (gate.response) return gate.response;
  const { session } = gate;
  const req = await getAuthRequest(env, String(params.id));
  if (!req) return fail('NOT_FOUND', EXPIRED, 404);
  const cl = await getClient(env, req.clientId);
  return json({
    app: appLabel(cl?.clientName ?? ''),
    clientName: cl?.clientName ?? 'AI app',
    redirectHost: hostOf(req.redirectUri),
    user: { name: session.fullName, email: session.email },
    allowed: await hasMcpAccess(env, { id: session.userId, role: session.role }),
  });
};

/** POST /api/ai-connector/consent/:id { decision: 'allow' | 'deny' }: the person's answer. Allow makes a one-time code
 *  for the signed-in person (session.userId) only, and only when the AI Connector is on for them. Either way the
 *  pending request is used up and the browser is sent back to the AI app. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await connectorGate(request, env, false);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ decision?: unknown }>().catch(() => null);
  const allow = body?.decision === 'allow';
  if (!allow && body?.decision !== 'deny') return fail('VALIDATION', 'Choose Allow or Cancel.', 422);
  if (allow && !(await hasMcpAccess(env, { id: session.userId, role: session.role }))) {
    return fail('FORBIDDEN', 'The AI Connector is not turned on for your account yet.', 403);
  }
  const req = await takeAuthRequest(env, String(params.id));
  if (!req) return fail('NOT_FOUND', EXPIRED, 404);
  const back = new URL(req.redirectUri);
  if (req.state) back.searchParams.set('state', req.state);
  if (!allow) {
    back.searchParams.set('error', 'access_denied');
    return json({ redirect: back.toString() });
  }
  const code = await createCode(env, { clientId: req.clientId, userId: session.userId, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge });
  back.searchParams.set('code', code);
  const cl = await getClient(env, req.clientId);
  await audit(env, { ...actorOf(session), action: 'ai_connector.connect', entityTable: 'mcp_oauth_clients', entityId: req.clientId, after: { app: appLabel(cl?.clientName ?? '') } });
  return json({ redirect: back.toString() });
};
