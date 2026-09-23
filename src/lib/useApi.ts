import { useEffect, useState } from 'react';
import { api, ApiFailure } from './api';

export interface Query<T> {
  data: T | null;
  loading: boolean;
  /** Already user-safe. Render it directly. */
  error: string | null;
  reload: () => void;
}

/**
 * Fetches once per path change. Pages pass a fallback so the UI renders while the
 * API is still stubbed — delete the fallback once the endpoint is live.
 *
 * `path` may be `null` to skip fetching entirely — for a detail call whose id comes
 * from a list that hasn't loaded yet, pass `list.length ? \`/thing?id=${id}\` : null`
 * rather than firing a request with a blank id that the API will only reject.
 */
export function useApi<T>(path: string | null, fallback?: T): Query<T> {
  // The fallback is design sample data. It exists only in dev; a real build shows nothing rather than invented figures.
  const [data, setData] = useState<T | null>(import.meta.env.DEV ? (fallback ?? null) : null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    api.get<T>(path)
      .then(r => { if (live) { setData(r); setError(null); } })
      .catch((e: unknown) => {
        if (!live) return;
        // With a fallback present the page still renders; the banner explains why
        // the figures are not live rather than blanking the screen.
        setError(e instanceof ApiFailure ? e.message : 'This list could not load. Check your connection and try again.');
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, nonce]);

  return { data, loading, error, reload: () => setNonce(n => n + 1) };
}

/** POST/PATCH helper with the same error contract. */
export function useMutation<TBody, TResult>(
  path: string,
  method: 'post' | 'patch' = 'post',
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string> | null>(null);

  async function run(body: TBody): Promise<TResult | null> {
    setBusy(true); setError(null); setFields(null);
    try {
      return await api[method]<TResult>(path, body);
    } catch (e) {
      if (e instanceof ApiFailure) { setError(e.message); setFields(e.fields ?? null); }
      else setError('Something failed and we could not read why. Try again.');
      return null;
    } finally { setBusy(false); }
  }

  return { run, busy, error, fields };
}
