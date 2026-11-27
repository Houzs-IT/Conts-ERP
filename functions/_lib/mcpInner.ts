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

/* ---------- one token check per lookup ----------
 * POST /api/mcp (functions/api/mcp/index.ts) checks the token at the door (resolveAccessToken: live, not revoked, the
 * person active, a desk account, approved) and then a tool call makes one or more in-process GETs as that person. Those
 * GETs reuse the answer for a few seconds instead of querying the token again in the session middleware. Every new
 * request from the AI app is still checked at the door, so Disconnect / Remove stop its NEXT request. Only reachable
 * with this isolate's secret (above), so a token sent from outside never meets this map. */
const VERIFIED_TTL_MS = 15_000;
const verified = new Map<string, { id: unknown; exp: number }>();

export function rememberVerified(token: string, id: unknown, now = Date.now()): void {
  if (verified.size > 500) for (const [k, v] of verified) if (v.exp <= now) verified.delete(k);
  verified.set(token, { id, exp: now + VERIFIED_TTL_MS });
}

export function recallVerified<T>(token: string, now = Date.now()): T | null {
  const e = verified.get(token);
  if (!e) return null;
  if (e.exp <= now) { verified.delete(token); return null; }
  return e.id as T;
}

/* ---------- the one write a confirmed action may make ----------
 * AI Connector actions (owner, 26 Nov 2026; functions/_lib/mcpActions.ts). confirm_action claims its mcp_pending_actions
 * row and only then grants a permit here for that action id: one person, one method + path from ACTION_ALLOWLIST, 60
 * seconds. Its in-process write carries this isolate's secret AND the action id in MCP_ACTION_HEADER; the session
 * middleware takes the permit (single use) and lets the write through only when everything matches
 * (connectorDecision). Never reachable from outside: the permit map lives in this isolate, and the header is useless
 * without the secret. */
export const MCP_ACTION_HEADER = 'x-conts-mcp-action';
const PERMIT_TTL_MS = 60_000;
const permits = new Map<string, { userId: string; method: string; path: string; exp: number; fence?: string }>();

/** `fence` (round 4b): the write kind whose body fence the middleware applies (mcpActions.ts BODY_FENCE). */
export function grantActionPermit(actionId: string, p: { userId: string; method: string; path: string; fence?: string }, now = Date.now()): void {
  if (permits.size > 200) for (const [k, v] of permits) if (v.exp <= now) permits.delete(k);
  permits.set(actionId, { ...p, method: p.method.toUpperCase(), exp: now + PERMIT_TTL_MS });
}

/** The permit for an action id, removed as it is taken: a second write with the same id finds none. */
export function takeActionPermit(actionId: string): { userId: string; method: string; path: string; exp: number; fence?: string } | null {
  const p = permits.get(actionId) ?? null;
  permits.delete(actionId);
  return p;
}
