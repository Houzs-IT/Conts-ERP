import type { Env } from './db';
import { inDemo } from './db';

/**
 * A heavy read whose answer is the same for everyone with the same scope, kept for SCOPE_CACHE_MS (performance,
 * 12 Nov 2026: the dashboard's figures run the statement engine over every owner on each visit). The answer carries
 * `cachedAt`, when it was worked out, so the screen can say its age; a write in between is not chased, a minute's age
 * is fine while it is shown.
 *
 * Two layers, neither needing any Cloudflare setup:
 *  - this isolate's memory, so a burst of visits to one worker computes it once;
 *  - the data centre's Cache API (caches.default), keyed by an address under /api that no browser can guess (a hash
 *    of the scope with SESSION_SECRET), so it is never served to a request on its own; where the Cache API is not
 *    available (local dev, some preview hosts) only memory is used.
 * Demo mode is never cached: it reads the demo store as well.
 * The caller still checks the session and works out the scope first; the scope must hold everything the answer
 * depends on (which figures the person may see, the period, the day).
 */
export const SCOPE_CACHE_MS = 60_000;

const memory = new Map<string, { at: number; body: string }>();
const MEMORY_MAX = 50;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function defaultCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

/** The answer for this scope: kept if it is under a minute old, otherwise worked out by `compute` and kept. */
export async function scopeCached<T extends object>(
  env: Env, request: Request, scope: string, compute: () => Promise<T>,
  { waitUntil, now = Date.now }: { waitUntil?: (p: Promise<unknown>) => void; now?: () => number } = {},
): Promise<T & { cachedAt: string }> {
  if (inDemo()) return { ...(await compute()), cachedAt: new Date(now()).toISOString() };

  const hit = memory.get(scope);
  if (hit && now() - hit.at < SCOPE_CACHE_MS) return JSON.parse(hit.body);

  const cache = defaultCache();
  const key = cache ? new Request(`${new URL(request.url).origin}/api/__scope/${await sha256(`${env.SESSION_SECRET ?? ''}\n${scope}`)}`) : null;
  if (cache && key) {
    try {
      const found = await cache.match(key);
      if (found) {
        const body = await found.text();
        const at = Date.parse((JSON.parse(body) as { cachedAt?: string }).cachedAt ?? '');
        if (Number.isFinite(at) && now() - at < SCOPE_CACHE_MS) { remember(scope, at, body); return JSON.parse(body); }
      }
    } catch { /* the cache is a speed-up only */ }
  }

  const at = now();
  const value = { ...(await compute()), cachedAt: new Date(at).toISOString() };
  const body = JSON.stringify(value);
  remember(scope, at, body);
  if (cache && key) {
    // Kept after the answer has gone out when the platform allows it; a failure only means the next visit works it out.
    const put = cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${SCOPE_CACHE_MS / 1000}` } })).catch(() => {});
    if (waitUntil) waitUntil(put); else await put;
  }
  return value;
}

function remember(scope: string, at: number, body: string) {
  memory.delete(scope);
  memory.set(scope, { at, body });
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
}

/** The tests. */
export function forgetScopeCache() { memory.clear(); }
