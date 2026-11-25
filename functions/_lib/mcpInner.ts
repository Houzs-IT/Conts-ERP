/**
 * AI Connector: proof that a request carrying an AI Connector token came from the connector's own tool runner in THIS
 * Worker isolate (functions/_lib/mcpServer.ts readEndpoint -> mcpDispatch.ts), never from outside.
 *
 * The session middleware (functions/api/_middleware.ts) accepts a `ctmcp_` token only together with this header and only
 * for GET/HEAD, so the token an AI app holds cannot be sent straight at /api/* to skip the connector's path gate and
 * the credential stripping. The secret is random per isolate, made on first use, and never leaves the isolate: the
 * connector's reads are dispatched in-process, not over the network.
 */
export const MCP_INNER_HEADER = 'x-conts-mcp-inner';

let secret: string | null = null;

/** This isolate's secret (made on first use). Only the in-process dispatcher puts it on a request. */
export function mcpInnerSecret(): string {
  if (!secret) {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    secret = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  return secret;
}

/** Whether a header value is this isolate's secret. False before any secret was made (so nothing outside can match),
 *  and compared in constant time. */
export function isMcpInner(value: string | null | undefined): boolean {
  if (!value || !secret || value.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= value.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
