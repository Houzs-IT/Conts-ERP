/**
 * Stale-while-revalidate read hook — the ERPs' `useCachedJson` pattern (Hookka),
 * a hand-rolled SWR (the `swr` package is a dead dep in both ERPs, so we match the
 * real hand-rolled layer). Returns the last-known localStorage value instantly,
 * background-refetches, and swaps in fresh data. Mutations must invalidate.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const NS = 'conts';

function read<T>(key: string): T | null {
  try { const c = localStorage.getItem(key); return c ? (JSON.parse(c) as T) : null; } catch { return null; }
}
function write<T>(key: string, v: T) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode / quota */ }
}

export interface CachedResult<T> { data: T | null; loading: boolean; fetching: boolean; error: string | null; reload: () => Promise<void> }

export function useCachedJson<T>(url: string, fetcher: (signal: AbortSignal) => Promise<T>): CachedResult<T> {
  const key = `${NS}:${url}`;
  const [data, setData] = useState<T | null>(() => read<T>(key));
  const [loading, setLoading] = useState(data == null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ac.current?.abort();
    const controller = new AbortController();
    ac.current = controller;
    setFetching(true);
    try {
      const fresh = await fetcher(controller.signal);
      if (controller.signal.aborted) return;
      setData(fresh); write(key, fresh); setError(null);
    } catch (e: unknown) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (!controller.signal.aborted) { setFetching(false); setLoading(false); }
    }
  }, [key, fetcher]);

  useEffect(() => { void load(); return () => ac.current?.abort(); }, [load]);

  return { data, loading, fetching, error, reload: load };
}

export function invalidateCache(url: string) { try { localStorage.removeItem(`${NS}:${url}`); } catch { /* ignore */ } }
export function invalidateCachePrefix(prefix: string) {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(`${NS}:${prefix}`)) localStorage.removeItem(k); } catch { /* ignore */ }
}
