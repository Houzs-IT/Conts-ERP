/**
 * AI Connector: what it may read (functions/_lib/mcpServer.ts). Pure, so it is unit-tested (src/lib/mcpAccess.test.mjs).
 *
 * The boundary is the ERP itself: every tool call re-enters the API in-process as a GET carrying the person's own
 * identity, so the session middleware and each handler's own checks decide, exactly as for that person's browser.
 * This file adds three things on top:
 *   1. paths the connector never reads: sign-in, the person's own security settings, door and lock credentials,
 *      machine-to-machine webhooks and sync, the public pages, and the connector itself;
 *   2. credential-shaped fields removed from every reply, whoever asks;
 *   3. the module list (from the API's own GET routes) for list_modules, and the leak check's helpers.
 */

/** Never readable through the connector, whatever the person's access. */
export const MCP_BLOCKED_PREFIXES = [
  '/api/auth', // sign-in, sessions, password reset, the staging account switcher
  '/api/account', // the person's own password, two-step sign-in and devices
  '/api/access-credentials', // door codes, lock and Wi-Fi passwords
  '/api/connect', // Houzs Connect checking a login, server to server
  '/api/public', // pages for guests who are not signed in
  '/api/mcp', // the connector itself
  '/api/ai-connector', // the connector's admin page
  '/api/demo', // Demo mode switch and its store
  '/api/supply-chain/engine-session', // issues a sign-in for the supply chain engine
  '/api/integrations/channex-webhook', // Channex calling us, and its webhook settings
  '/api/integrations/channex-webhook-setup',
  '/api/integrations/hostplatform-webhook',
  '/api/import', // pulls from HostPlatform
  '/api/system/health/hub-report', // the cron worker's report to the IT Hub
  '/api/table-layouts', // a person's own column layouts, not business data
];

export type PathDecision = { ok: true; path: string } | { ok: false; reason: string };

/** Normalises and gates one endpoint path (no query string). */
export function classifyPath(raw: string): PathDecision {
  const p = String(raw ?? '').trim().split('?')[0].split('#')[0];
  if (!p.startsWith('/api/')) return { ok: false, reason: 'Paths start with /api/. Use list_modules and list_endpoints to find one.' };
  if (p.length > 300 || /\.\.|\/\/|%2e|%2f|%5c|\\/i.test(p)) return { ok: false, reason: 'Invalid path.' };
  const path = p.replace(/\/+$/, '');
  const lower = path.toLowerCase();
  // A full bank account number is shown only to a person who presses Reveal on the screen (owners/:id/reveal,
  // owners/:id/accounts/:accountId/reveal); the connector never asks for one.
  if (MCP_BLOCKED_PREFIXES.some(b => lower === b || lower.startsWith(`${b}/`)) || /\/reveal$/.test(lower)) {
    return { ok: false, reason: 'That part of the ERP is not available through the AI Connector (sign-in, security settings, door codes and system connections are never shared).' };
  }
  return { ok: true, path };
}

/** Field names removed from every reply: credentials and secrets, never needed to answer a question. */
export const SECRET_KEY = /(password|passwd|secret|token|api_?key|pin_?hash|pin_?code|totp|otp_|backup_?code|private_?key|signing_?key|webhook|session_?id|sso)/i;

/** Removes credential-shaped fields at any depth. Returns the cleaned value and the field names removed. */
export function redactSecrets(v: unknown): { value: unknown; removed: Set<string> } {
  const removed = new Set<string>();
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 40) return null;
    if (Array.isArray(x)) return x.map(y => walk(y, depth + 1));
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) { removed.add(k); continue; }
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return x;
  };
  return { value: walk(v, 0), removed };
}

/** Money and people field names: the leak check reports where these reach a staff account (names only, never values). */
export const SENSITIVE_KEY = /(cost|salary|wage|payroll|margin|profit|commission|ic_?no|ic_?num|nric|passport|bank_?acc|account_?no|basic_?pay|allowance|epf|socso|pcb)/i;

export interface RouteInfo { method: string; path: string }

/** Readable GET endpoints (no catch-alls, not blocked), sorted. `prefix` limits them to one module. */
export function readablePaths(routes: RouteInfo[], prefix: string | null): string[] {
  const set = new Set<string>();
  for (const r of routes) {
    if (r.method !== 'GET' && r.method !== '') continue;
    if (!r.path.startsWith('/api/') || r.path.includes('*')) continue;
    if (prefix && !(r.path === prefix || r.path.startsWith(`${prefix}/`))) continue;
    if (!classifyPath(r.path.replace(/:[^/]+/g, 'x')).ok) continue;
    set.add(r.path);
  }
  return [...set].sort();
}

/** One module per first path segment under /api, with how many readable endpoints it has. */
export function moduleCatalog(routes: RouteInfo[]): { prefix: string; endpoints: number }[] {
  const counts = new Map<string, number>();
  for (const p of readablePaths(routes, null)) {
    const prefix = `/api/${p.split('/')[2]}`;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()].map(([prefix, endpoints]) => ({ prefix, endpoints })).sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/** The endpoints the leak check opens: parameter-free GETs. */
export function leakCheckPaths(routes: RouteInfo[]): string[] {
  return readablePaths(routes, null).filter(p => !p.includes(':'));
}

/** Every key name in a JSON value (any depth, capped). */
export function jsonKeys(v: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || out.size > 2000) return out;
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) jsonKeys(x, out, depth + 1);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.add(k); jsonKeys(x, out, depth + 1); }
  }
  return out;
}

export interface LeakRow { path: string; outcome: 'opened' | 'refused' | 'error'; status: number; hidden: string[]; sensitive: string[] }

/** One leak check result: refused, an error, or opened with the money / people field names the reply carried. */
export function analyseBody(path: string, status: number, isError: boolean, body: unknown, removed: string[]): LeakRow {
  if (status === 401 || status === 403) return { path, outcome: 'refused', status, hidden: [], sensitive: [] };
  if (isError) return { path, outcome: 'error', status, hidden: [], sensitive: [] };
  const keys = [...jsonKeys(body)];
  return { path, outcome: 'opened', status, hidden: removed, sensitive: keys.filter(k => SENSITIVE_KEY.test(k) && !SECRET_KEY.test(k)).sort() };
}

/** A friendly app name for the admin page, from the name the AI app registered with. */
export function appLabel(clientName: string): string {
  const n = (clientName || '').toLowerCase();
  if (n.includes('claude')) return 'Claude';
  if (n.includes('chatgpt') || n.includes('openai')) return 'ChatGPT';
  if (n.includes('gemini') || n.includes('google')) return 'Gemini';
  return clientName || 'AI app';
}

/** A redirect URI an AI app may register: https anywhere, plain http only for this computer (loopback). */
export function validRedirectUri(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** PKCE S256 (RFC 7636): BASE64URL(SHA-256(verifier)). */
export async function pkceS256(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
