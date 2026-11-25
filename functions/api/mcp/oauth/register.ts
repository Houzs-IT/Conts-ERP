import { type Env, json } from '../../../_lib/db';
import { mcpReady, registerClient } from '../../../_lib/mcpStore';
import { validRedirectUri } from '../../../_lib/mcpAccess';

/**
 * POST /api/mcp/oauth/register: OAuth dynamic client registration (RFC 7591) for the AI Connector. An AI app (Claude,
 * ChatGPT) registers itself as a public client with its return addresses: https anywhere, plain http only for this
 * computer. Registering gives no access to anything: a person still signs in and presses Allow (api/ai-connector/consent).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await mcpReady(env))) return json({ error: 'temporarily_unavailable', error_description: 'The AI Connector is not set up on this system yet.' }, 503);
  const body = await request.json<{ client_name?: unknown; redirect_uris?: unknown }>().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_client_metadata', error_description: 'JSON body required' }, 400);
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (uris.length === 0 || uris.length > 5 || uris.some(u => u.length > 500 || !validRedirectUri(u))) {
    return json({ error: 'invalid_redirect_uri', error_description: '1 to 5 https redirect URIs are required (http only for localhost)' }, 400);
  }
  const cl = await registerClient(env, typeof body.client_name === 'string' ? body.client_name : 'AI app', uris);
  return json({
    client_id: cl.clientId,
    client_name: cl.clientName,
    redirect_uris: cl.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, 201, { 'cache-control': 'no-store' });
};
