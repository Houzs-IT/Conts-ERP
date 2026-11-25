import { type Env, json } from '../../_lib/db';
import { mcpReady, resolveAccessToken } from '../../_lib/mcpStore';
import { handleRpc, originOf, type RpcReq } from '../../_lib/mcpServer';

/**
 * POST /api/mcp: the AI Connector's MCP endpoint (Streamable HTTP, stateless JSON-RPC), called by Claude or ChatGPT
 * with the person's connector token (Bearer ctmcp_...). Public in the session middleware: this handler checks the
 * token itself (resolveAccessToken: live, not revoked, the person still active and allowed). Read-only: every tool
 * reads through the API as that person (functions/_lib/mcpServer.ts).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (!(await mcpReady(env))) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'The AI Connector is not set up on this system yet.' } }, 503);
  }
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  const id = token ? await resolveAccessToken(env, token) : null;
  if (!id) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401, {
      'www-authenticate': `Bearer realm="conts-erp", resource_metadata="${originOf(request)}/.well-known/oauth-protected-resource/api/mcp"${token ? ', error="invalid_token"' : ''}`,
    });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcReq[];
  if (msgs.length === 0 || msgs.length > 20) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400);
  const out: unknown[] = [];
  for (const m of msgs) {
    const r = await handleRpc(request, env, waitUntil, id, token, m);
    if (r) out.push(r);
  }
  if (out.length === 0) return new Response(null, { status: 202 });
  return json(batch ? out : out[0]);
};

/** The server keeps no stream open for the AI app (stateless), so GET is not offered. */
export const onRequestGet: PagesFunction<Env> = async () =>
  json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST (MCP Streamable HTTP).' } }, 405, { allow: 'POST' });
