import { type Env } from '../../../_lib/db';
import { createAuthRequest, getClient, mcpReady } from '../../../_lib/mcpStore';
import { originOf } from '../../../_lib/mcpDiscovery';

const plain = (msg: string, status = 400) =>
  new Response(`${msg}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * GET /api/mcp/oauth/authorize: the AI app sends the person's browser here. The request is checked (a registered
 * client, its own return address, response_type=code, PKCE S256), kept for 10 minutes, and the browser goes on to the
 * app's /ai-connect screen, which signs the person in if needed and asks Allow or Cancel (api/ai-connector/consent).
 * Nothing is granted here.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await mcpReady(env))) return plain('The AI Connector is not set up on this system yet.', 503);
  const q = new URL(request.url).searchParams;
  const get = (k: string) => q.get(k) ?? '';
  const clientId = get('client_id');
  const redirectUri = get('redirect_uri');
  if (!clientId || !redirectUri) return plain('Invalid request: the AI app or its return address is missing.');
  const cl = await getClient(env, clientId);
  if (!cl) return plain('This AI app is not registered. Remove the connector in the AI app and add it again.');
  if (!cl.redirectUris.includes(redirectUri)) return plain('Invalid request: the return address does not match this AI app.');
  if (get('response_type') !== 'code') return plain('Only response_type=code is supported.');
  const challenge = get('code_challenge');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || get('code_challenge_method') !== 'S256') return plain('This AI app must use PKCE (S256).');
  const id = await createAuthRequest(env, { clientId, redirectUri, state: get('state'), codeChallenge: challenge });
  return new Response(null, { status: 302, headers: { location: `${originOf(request)}/ai-connect?request=${encodeURIComponent(id)}`, 'cache-control': 'no-store' } });
};
