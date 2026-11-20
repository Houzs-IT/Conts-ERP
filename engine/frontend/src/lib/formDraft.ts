/* A long create/edit form keeps its unsaved fields in this browser, so a reload, a crash or a closed tab does not
   lose them (audit 20 Nov 2026, items 25-26). Nothing is applied by itself: the form shows
   "Restore unsaved draft from <time>?" and the person picks Restore or Discard; typing instead of answering drops
   the old draft. Same store and timing as the renovation drafts (lib/renovation/renovationFormDraft.ts: 7 days,
   storage errors ignored), under its own prefix and keyed by user, company, form and record, so one person's draft
   is never offered to another login on a shared PC. Two tabs of the same new form share one draft: the last write
   wins.
   Only fields the form shows go in, plus the form's idempotency key: a save that reached the server but whose answer
   was lost replays to the same document when the restored form is saved again, instead of making a second one. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getBrowserStorageIdentity, subscribeBrowserStorageIdentity, type BrowserStorageIdentity } from './storageIdentity';
import { clearDraft, readDraft, useRenovationDraft } from './renovation/renovationFormDraft';
import type { ContentBoundKey, ContentKeySnapshot } from './idempotency';

export const FORM_DRAFT_PREFIX = 'conts:form-draft:';
const BASELINE_DELAY_MS = 300;

/** What is stored: the form's fields and the idempotency key of its last save, if any. */
type Stored<T> = { f: T; k: ContentKeySnapshot | null };
/* Read back from storage, so checked rather than trusted. */
const isStored = <T>(v: unknown): v is Stored<T> => typeof v === 'object' && v !== null && 'f' in v;

/** `u<user>:c<company>:<form>:<record id or "new">`, or null before the login is known (nothing is kept then). */
export function formDraftKey(identity: BrowserStorageIdentity | null, form: string, recordId: string | number | null | undefined): string | null {
  if (!identity) return null;
  const id = recordId == null || recordId === '' ? 'new' : String(recordId);
  return `u${identity.userId}:c${identity.companyId}:${form}:${id}`;
}

export function readFormDraft<T>(key: string): { v: T; ts: number; version: number | null; k: ContentKeySnapshot | null } | null {
  const d = readDraft<unknown>(key, Date.now(), FORM_DRAFT_PREFIX);
  return d && isStored<T>(d.v) ? { v: d.v.f, ts: d.ts, version: d.version, k: d.v.k } : null;
}

export function clearFormDraft(key: string): void {
  clearDraft(key, FORM_DRAFT_PREFIX);
}

export type FormDraft<T> = {
  /** The earlier draft on offer (show the restore bar while this is set), or null. */
  offered: { v: T; ts: number } | null;
  /** True when the record was saved again after the draft was written (edit forms only). */
  stale: boolean;
  /** Restore: hands the stored fields to `apply` (and takes back the stored idempotency key), then stops offering. */
  restore: (apply: (value: T) => void) => void;
  /** Discard: deletes the stored draft. */
  discard: () => void;
  /** Call after a successful save. */
  clear: () => void;
};

/**
 * form: a stable name ("so-new"); recordId: the record being edited, or null/"new" for a create form.
 * value: what the form shows. It is kept 0.5 s after the last change once it differs from what the form held when
 *   it became ready (so an untouched form, or one prefilled from a source document, is never kept), and only while
 *   `meaningful` (the form holds something worth keeping, e.g. a customer or an item picked).
 * enabled: false while the form is not ready yet (still loading or prefilling), so nothing is read or written.
 * version: an edit form's record version (its updated_at), so a draft older than the record says so.
 * keys: the form's content-bound idempotency key, kept with the draft.
 */
export function useFormDraft<T>(
  form: string,
  recordId: string | number | null | undefined,
  value: T,
  opts: { enabled?: boolean; meaningful?: boolean; version?: number | null; keys?: ContentBoundKey } = {},
): FormDraft<T> {
  const identity = useSyncExternalStore(subscribeBrowserStorageIdentity, getBrowserStorageIdentity, getBrowserStorageIdentity);
  const key = opts.enabled === false ? null : formDraftKey(identity, form, recordId);
  const sig = JSON.stringify(value);
  const latestSig = useRef(sig);
  latestSig.current = sig;
  /* What the form held once ready, read a moment after `enabled` turns on so the form's own prefill effects
     (source document, defaults) have landed first. */
  const [base, setBase] = useState<{ key: string; sig: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => setBase({ key, sig: latestSig.current }), BASELINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [key]);
  const changedByUser = !!key && base?.key === key && base.sig !== sig;
  const dirty = changedByUser && opts.meaningful !== false;

  const keys = opts.keys;
  const [keySnap, setKeySnap] = useState<ContentKeySnapshot | null>(() => keys?.snapshot() ?? null);
  useEffect(() => {
    if (!keys) return;
    setKeySnap(keys.snapshot());
    return keys.subscribe(() => setKeySnap(keys.snapshot()));
  }, [keys]);
  const keySig = keySnap ? `${keySnap.key}|${keySnap.sig}` : '';

  /* Forms rebuild `value` on every render; held by its content so the 0.5 s save timer is not restarted by a
     re-render that changed nothing. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stored = useMemo<Stored<T>>(() => ({ f: value, k: keySnap }), [sig, keySig]);
  const d = useRenovationDraft<Stored<T>>(key, stored, dirty, opts.version ?? null, FORM_DRAFT_PREFIX);
  const { offered, answer } = d;

  /* Typing instead of answering the bar drops the old draft: the bar goes, and from then on this typing is kept. */
  useEffect(() => {
    if (offered && changedByUser) answer(false);
  }, [offered, changedByUser, answer]);

  const restore = useCallback((apply: (value: T) => void) => {
    const v: unknown = offered?.v;
    if (isStored<T>(v)) {
      try { apply(v.f); } catch { /* a draft that no longer fits the form is dropped */ }
      if (v.k && keys) keys.adopt(v.k);
    }
    answer(true);
  }, [offered, answer, keys]);
  const discard = useCallback(() => answer(false), [answer]);
  const offeredV: unknown = offered?.v;
  const shown = offered && isStored<T>(offeredV) ? { v: offeredV.f, ts: offered.ts } : null;
  return { offered: shown, stale: d.stale, restore, discard, clear: d.clear };
}
