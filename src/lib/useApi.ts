import { useCallback, useEffect, useRef, useState } from 'react';
import { answeredWithin, api, ApiFailure, errorMessage, isAbort, readCache, remember, writeCount } from './api';
import { snapshotOf } from './snapshots';
import { hideSnapshot, showSnapshot, snapshotSlot } from './snapshotView';

/* How many reads are refreshing figures that are already on screen. The shell draws one thin gold line while it is
   above zero, so stale-but-shown data visibly says it is being brought up to date. */
let refreshing = 0;
const listeners = new Set<() => void>();
export const refreshingCount = () => refreshing;
export function subscribeRefreshing(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function holdRefreshing() {
  refreshing++; listeners.forEach(l => l());
  return () => { refreshing--; listeners.forEach(l => l()); };
}

/** Reads on their way, by path, with the write count when each was sent (api.ts writeCount). A later read joins one
 *  only if no write has run since it was sent: a screen opened after a save must not be handed the answer to a read
 *  sent before it. */
const pendingReads = new Map<string, { promise: Promise<unknown>; sentAt: number }>();
/** Reads whose answer is kept under a path not known until it arrives (prefetchAs), by the start of that path. */
const pendingAs = new Map<string, Promise<unknown>>();
/** One read of `path`, shared with any other screen asking for it at the same time. The answer is kept in readCache
 *  only when no write ran while it was on its way. */
export function sharedGet<T>(path: string): Promise<T> {
  const sentAt = writeCount();
  const joined = pendingReads.get(path);
  if (joined && joined.sentAt === sentAt) return joined.promise as Promise<T>;
  // A read that may answer this one is on its way (prefetchAs): wait for it, and ask only if it did not.
  const before = [...pendingAs].find(([start]) => path.startsWith(start))?.[1];
  const ask = () => api.get<T>(path).then(r => { remember(path, r, sentAt); return r; });
  const promise: Promise<T> = before
    ? before.then(() => (answeredWithin(path, FRESH_MS) ? readCache.get(path) as T : ask()))
    : ask();
  const entry = { promise: promise as Promise<unknown>, sentAt };
  pendingReads.set(path, entry);
  // Only its own entry: a newer read sent after a write may have taken its place, and later screens join that one.
  const settle = () => { if (pendingReads.get(path) === entry) pendingReads.delete(path); };
  promise.then(settle, settle);
  return promise;
}

/** An answer this recent is shown as it is, with no second read: a tab switched back and forth, or a page whose data
 *  was asked for while its code was still downloading (prefetch). Older answers still show at once and are re-read. */
const FRESH_MS = 10_000;

/** Starts a read a screen is about to make, so it runs while the screen's code downloads (App.tsx routes). The
 *  screen's own useApi of the same path joins it, or uses its answer, instead of asking again. */
export function prefetch(path: string) {
  if (pendingReads.get(path)?.sentAt === writeCount() || answeredWithin(path, FRESH_MS)) return;
  sharedGet(path).catch(() => { /* the screen's own read reports it */ });
}

/** Starts a read whose answer a screen will ask for under another path, one it cannot name until something else has
 *  loaded: the Units screen's first unit record (/units/detail?first=1), which it asks for as ?unitId= once the tree is
 *  in. The answer is kept under `keyOf(answer)` as well; until it arrives, a read of any path starting with `start`
 *  waits for it and asks the server only when the answer was for another path. */
export function prefetchAs<T>(path: string, start: string, keyOf: (answer: T) => string | null) {
  if (pendingAs.has(start) || answeredWithin(path, FRESH_MS)) return;
  const sentAt = writeCount();
  const read: Promise<unknown> = api.get<T>(path)
    .then(r => { remember(path, r, sentAt); const key = keyOf(r); if (key) remember(key, r, sentAt); })
    .catch(() => { /* the screen's own read asks again and reports it */ })
    .finally(() => { if (pendingAs.get(start) === read) pendingAs.delete(start); });
  pendingAs.set(start, read);
}

export interface Query<T> {
  data: T | null;
  loading: boolean;
  /** Already user-safe. Render it directly. */
  error: string | null;
  reload: () => void;
  /** For a timer: reads again unless a read of this screen is still on its way, so a slow answer is not stacked
   *  under more of the same. After a save, call reload, which always reads again. */
  poll: () => void;
  /** True while `data` is the saved answer from an earlier visit (lib/snapshots.ts), until the fresh one lands. Every
   *  action is disabled meanwhile (lib/snapshotView.ts); a screen hides money figures from it (owner, rule 3). */
  fromSnapshot: boolean;
}

/**
 * Fetches once per path change, showing the last answer for that path (lib/api.ts readCache) while it does. Pages pass a fallback so the UI renders while the
 * API is still stubbed — delete the fallback once the endpoint is live.
 *
 * `path` may be `null` to skip fetching entirely — for a detail call whose id comes
 * from a list that hasn't loaded yet, pass `list.length ? \`/thing?id=${id}\` : null`
 * rather than firing a request with a blank id that the API will only reject.
 */
export function useApi<T>(path: string | null, fallback?: T): Query<T> {
  // The fallback is design sample data. It exists only in dev; a real build shows nothing rather than invented figures.
  const cached = path !== null ? readCache.get(path) as T | undefined : undefined;
  // Nothing from this tab yet: the answer saved on an earlier visit, shown at once while the read below refreshes it.
  const [saved] = useState(() => (path !== null && cached === undefined ? snapshotOf(path) : undefined));
  const [data, setData] = useState<T | null>(cached ?? (saved?.data as T | undefined) ?? (import.meta.env.DEV ? (fallback ?? null) : null));
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const inFlight = useRef(false);
  /** When the snapshot on screen was saved; null once fresh data is shown. */
  const [snapAt, setSnapAt] = useState<number | null>(saved?.savedAt ?? null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    if (path === null) { setLoading(false); setSnapAt(null); return; }
    let live = true;
    setLoading(true);
    // A page revisited (or a range switched back) shows its last answer straight away; the read below refreshes it.
    const seen = readCache.get(path) as T | undefined;
    if (seen !== undefined) { setData(seen); setSnapAt(null); }
    else {
      const snap = snapshotOf(path);
      if (snap) { setData(snap.data as T); setSnapAt(snap.savedAt); setRefreshFailed(false); }
      else setSnapAt(null);
    }
    // Read a moment ago (a prefetch, or this tab a few seconds back): nothing to refresh.
    if (!nonce && seen !== undefined && answeredWithin(path, FRESH_MS)) { setError(null); setLoading(false); return; }
    // A reload after a save must not join a read sent before the save.
    const sentAt = writeCount();
    inFlight.current = true;
    (nonce ? api.get<T>(path).then(r => { remember(path, r, sentAt); return r; }) : sharedGet<T>(path))
      // Fresh data replaces a snapshot at once; the lock lifts after it is on screen (the effect below).
      .then(r => { if (live) { setData(r); setError(null); setSnapAt(null); setRefreshFailed(false); } })
      .catch((e: unknown) => {
        // A read cancelled on the way (the page left, the browser stopped it) is not a failure: no error state, and the
        // next visit reads again (only answers are kept in readCache, never failures).
        if (!live || isAbort(e)) return;
        // With a fallback present the page still renders; the banner explains why
        // the figures are not live rather than blanking the screen.
        setError(errorMessage(e, 'This list could not load. Check your connection and try again.'));
        // A snapshot stays on screen, marked "Couldn't refresh", and actions stay disabled until a retry lands.
        setRefreshFailed(true);
      })
      .finally(() => { if (live) { setLoading(false); inFlight.current = false; } });
    return () => { live = false; inFlight.current = false; };
  }, [path, nonce]);

  const stale = loading && data !== null;
  useEffect(() => (stale ? holdRefreshing() : undefined), [stale]);

  // The same functions on every render, so a timer set up with them is not torn down and set again each time.
  const reload = useCallback(() => setNonce(n => n + 1), []);
  const poll = useCallback(() => { if (!inFlight.current) setNonce(n => n + 1); }, []);

  // While a snapshot is on screen the page says how old it is and every action stays disabled (lib/snapshotView.ts).
  const slot = useRef(0);
  if (!slot.current) slot.current = snapshotSlot();
  useEffect(() => {
    if (snapAt === null) return;
    const id = slot.current;
    showSnapshot(id, { savedAt: snapAt, failed: refreshFailed, retry: reload });
    return () => hideSnapshot(id);
  }, [snapAt, refreshFailed, reload]);

  return { data, loading, error, reload, poll, fromSnapshot: snapAt !== null };
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
