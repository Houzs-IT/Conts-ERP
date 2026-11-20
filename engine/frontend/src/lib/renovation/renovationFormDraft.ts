/* Unsaved edits on a long renovation form are kept in this browser, so a closed tab,
   a dropped connection or a phone that reloads the page does not lose them. Nothing
   is applied by itself: the form offers "Restore your draft?" and the person picks.
   Adapted from Hookka src/lib/use-form-draft.ts. */
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'conts:reno-draft:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 500;

export type StoredDraft<T> = { v: T; ts: number; version: number | null };

export function readDraft<T>(key: string, now = Date.now(), prefix = PREFIX): StoredDraft<T> | null {
  try {
    const raw = localStorage.getItem(prefix + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.ts !== 'number' || !('v' in parsed)) return null;
    if (now - parsed.ts > TTL_MS) { localStorage.removeItem(prefix + key); return null; }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T, version: number | null, prefix = PREFIX): void {
  try {
    localStorage.setItem(prefix + key, JSON.stringify({ v: value, ts: Date.now(), version } satisfies StoredDraft<T>));
  } catch {
    /* storage full or blocked: the draft is best-effort */
  }
}

export function clearDraft(key: string, prefix = PREFIX): void {
  try { localStorage.removeItem(prefix + key); } catch { /* ignore */ }
}

/**
 * key: null while the form is not editable (nothing is read or written).
 * value: the form's editable fields; saved 0.5 s after the last change while dirty.
 * version: the record's version when the form loaded, so an older draft can say so.
 *
 * While an earlier draft is still on offer nothing is saved, so typing before
 * answering cannot overwrite it. After clear() the value it was cleared with is
 * not saved again, so a save landing a moment after the last keystroke is not
 * written back as a draft while the page leaves; a later edit is kept as usual.
 */
export function useRenovationDraft<T>(key: string | null, value: T, dirty: boolean, version: number | null, prefix = PREFIX) {
  const [offered, setOffered] = useState<StoredDraft<T> | null>(null);
  const [decided, setDecided] = useState(false);
  const clearedValue = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readFor = useRef<string | null>(null);

  useEffect(() => {
    if (key === readFor.current) return;
    readFor.current = key;
    setOffered(key ? readDraft<T>(key, Date.now(), prefix) : null);
    setDecided(false);
    clearedValue.current = null;
  }, [key, prefix]);

  const pending = offered !== null && !decided;

  useEffect(() => {
    if (!key || !dirty || pending) return;
    if (clearedValue.current && Object.is(clearedValue.current.v, value)) return;
    const t = setTimeout(() => writeDraft(key, value, version, prefix), SAVE_DELAY_MS);
    timer.current = t;
    return () => clearTimeout(t);
  }, [key, value, dirty, pending, version, prefix]);

  const latestValue = useRef(value);
  latestValue.current = value;
  /** Call after a successful save, so the saved form is not offered back. */
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (key) clearDraft(key, prefix);
    clearedValue.current = { v: latestValue.current };
    setOffered(null); setDecided(true);
  }, [key, prefix]);
  /** The person chose: restore (caller applies offered.v) or discard. */
  const answer = useCallback((restore: boolean) => {
    if (!restore && key) clearDraft(key, prefix);
    setDecided(true);
  }, [key, prefix]);

  return {
    /** The earlier draft on offer, or null. */
    offered: pending ? offered : null,
    /** True when the record was saved again after this draft was written. */
    stale: pending && offered!.version !== null && version !== null && offered!.version !== version,
    clear,
    answer,
  };
}
