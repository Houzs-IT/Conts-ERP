/* Unsaved edits on a long renovation form are kept in this browser, so a closed tab,
   a dropped connection or a phone that reloads the page does not lose them. Nothing
   is applied by itself: the form offers "Restore your draft?" and the person picks.
   Adapted from Hookka src/lib/use-form-draft.ts. */
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'conts:reno-draft:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 500;

export type StoredDraft<T> = { v: T; ts: number; version: number | null };

export function readDraft<T>(key: string, now = Date.now()): StoredDraft<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.ts !== 'number' || !('v' in parsed)) return null;
    if (now - parsed.ts > TTL_MS) { localStorage.removeItem(PREFIX + key); return null; }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T, version: number | null): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, ts: Date.now(), version } satisfies StoredDraft<T>));
  } catch {
    /* storage full or blocked: the draft is best-effort */
  }
}

export function clearDraft(key: string): void {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

/**
 * key: null while the form is not editable (nothing is read or written).
 * value: the form's editable fields; saved 0.5 s after the last change while dirty.
 * version: the record's version when the form loaded, so an older draft can say so.
 *
 * While an earlier draft is still on offer nothing is saved, so typing before
 * answering cannot overwrite it.
 */
export function useRenovationDraft<T>(key: string | null, value: T, dirty: boolean, version: number | null) {
  const [offered, setOffered] = useState<StoredDraft<T> | null>(null);
  const [decided, setDecided] = useState(false);
  const readFor = useRef<string | null>(null);

  useEffect(() => {
    if (key === readFor.current) return;
    readFor.current = key;
    setOffered(key ? readDraft<T>(key) : null);
    setDecided(false);
  }, [key]);

  const pending = offered !== null && !decided;

  useEffect(() => {
    if (!key || !dirty || pending) return;
    const t = setTimeout(() => writeDraft(key, value, version), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [key, value, dirty, pending, version]);

  /** Call after a successful save, so the saved form is not offered back. */
  const clear = useCallback(() => { if (key) clearDraft(key); setOffered(null); setDecided(true); }, [key]);
  /** The person chose: restore (caller applies offered.v) or discard. */
  const answer = useCallback((restore: boolean) => {
    if (!restore && key) clearDraft(key);
    setDecided(true);
  }, [key]);

  return {
    /** The earlier draft on offer, or null. */
    offered: pending ? offered : null,
    /** True when the record was saved again after this draft was written. */
    stale: pending && offered!.version !== null && version !== null && offered!.version !== version,
    clear,
    answer,
  };
}
