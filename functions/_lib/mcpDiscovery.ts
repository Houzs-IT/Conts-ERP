/** AI Connector OAuth discovery documents (RFC 9728, RFC 8414), served at the site root by functions/.well-known and
 *  pointing at the endpoints under /api/mcp. Kept apart from mcpServer.ts so the discovery functions load nothing else. */

/** The address the person used (erp.theconts.com, or a pages.dev address on staging): Pages serves the API itself. */
export const originOf = (request: Request) => new URL(request.url).origin;

export function protectedResourceMetadata(origin: string) {
  return { resource: `${origin}/api/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'], scopes_supported: ['erp.read'], resource_name: 'The Conts ERP' };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['erp.read'],
  };
}

/** The discovery documents, for functions/.well-known. Nothing secret, so they may be read from anywhere. */
export function discoveryResponse(request: Request, kind: 'resource' | 'server'): Response {
  const origin = originOf(request);
  const body = kind === 'resource' ? protectedResourceMetadata(origin) : authorizationServerMetadata(origin);
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
}

