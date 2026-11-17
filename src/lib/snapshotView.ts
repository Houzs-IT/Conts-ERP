/**
 * Which saved answers (lib/snapshots.ts) are on screen right now, and the lock that keeps every action disabled while
 * any is (owner, 12 Nov 2026, rule 2): a snapshot is shown so the page is not blank, but nobody books, blocks,
 * assigns, marks done or records a payment against it. Only once every read on the page has its fresh answer do the
 * actions open, and by then the page already shows that answer (a job someone else took shows as taken first).
 *
 * The lock is global and needs no code in a screen:
 *  - Button (components/Button.tsx) shows itself disabled with the tooltip "Refreshing…".
 *  - installActionGuard() stops a click on any other button, checkbox or select on the page, and gives it the same
 *    tooltip; tokens.css greys them out (html[data-snapshot-shown]).
 *  - Navigation that changes nothing (the menus, tabs, filters, pagers, the Retry button) is marked data-live and
 *    stays usable.
 * The calendar's drag-to-book and drag-to-move check snapshotLocked() themselves (CalendarPage).
 */
import { useSyncExternalStore } from 'react';

export interface ShownSnapshot { savedAt: number; failed: boolean; retry: () => void }

const shown = new Map<number, ShownSnapshot>();
const listeners = new Set<() => void>();
let nextId = 1;
let version = 0;

function changed() {
  version++;
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-snapshot-shown', shown.size > 0);
  listeners.forEach(l => l());
}

/** An id for one read (one useApi) that may show a snapshot. */
export const snapshotSlot = () => nextId++;

/** This read is showing its saved answer (since `savedAt`); `failed` once its fresh read failed. */
export function showSnapshot(id: number, s: ShownSnapshot) { shown.set(id, s); changed(); }

/** This read's fresh answer landed, or the screen left. */
export function hideSnapshot(id: number) { if (shown.delete(id)) changed(); }

/** True while any read on screen shows a saved answer: every action stays disabled. */
export const snapshotLocked = () => shown.size > 0;

/** For the header note: the oldest saved answer on screen and whether any fresh read failed. */
export function snapshotState(): { savedAt: number; failed: boolean } | null {
  if (!shown.size) return null;
  let savedAt = Infinity, failed = false;
  for (const s of shown.values()) { savedAt = Math.min(savedAt, s.savedAt); failed ||= s.failed; }
  return { savedAt, failed };
}

/** Retry for "Couldn't refresh": reads every failed one again. */
export function retrySnapshots() { [...shown.values()].filter(s => s.failed).forEach(s => s.retry()); }

export function subscribeSnapshots(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Re-renders when the lock or the note changes. */
export function useSnapshotView(): number {
  return useSyncExternalStore(subscribeSnapshots, () => version, () => version);
}

/** True while actions must stay disabled. */
export function useSnapshotLock(): boolean {
  useSnapshotView();
  return snapshotLocked();
}

export const REFRESHING = 'Refreshing…';

/** The controls that act. Links (<a>) only move between pages and are never stopped. */
const ACTION = 'button, [role="button"], [role="menuitem"], [role="switch"], [role="checkbox"], input[type="checkbox"], input[type="radio"], input[type="submit"], select';

interface ElementLike { closest(selector: string): ElementLike | null }

/** The action control a click on `target` would work, or null when the click must go through: nothing is locked,
 *  it is not on an action, or the control sits in something marked data-live (menus, tabs, filters, pagers). */
export function lockedControl<T extends ElementLike>(target: T | null): T | null {
  if (!snapshotLocked() || !target || typeof target.closest !== 'function') return null;
  const control = target.closest(ACTION) as T | null;
  if (!control) return null;
  // Only the page and what opens over it: the menu, the top bar and the tab bar stay usable.
  if (!control.closest('[data-app-main], [role="dialog"], [aria-modal="true"]')) return null;
  // Tabs, menus of pages, filters, pagers and column headers change nothing.
  if (control.closest('[data-live], [role="tablist"], [role="tab"], nav')) return null;
  return control;
}

/** Stops clicks on actions while a snapshot is shown, and gives them the "Refreshing…" tooltip. Installed once
 *  (main.tsx). Capture phase, so it runs before any screen's own handler. */
export function installActionGuard(doc: Document = document) {
  const stop = (e: Event) => {
    if (!lockedControl(e.target as Element | null)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  doc.addEventListener('click', stop, true);
  doc.addEventListener('change', stop, true);
  // A form sent with Enter is an action too.
  doc.addEventListener('submit', e => {
    const form = e.target as Element | null;
    if (!snapshotLocked() || !form || typeof form.closest !== 'function' || form.closest('[data-live]')) return;
    if (!form.closest('[data-app-main], [role="dialog"], [aria-modal="true"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  doc.addEventListener('mouseover', e => {
    const c = lockedControl(e.target as HTMLElement | null) as HTMLElement | null;
    if (!c || c.dataset.snapshotTitle !== undefined) return;
    c.dataset.snapshotTitle = c.getAttribute('title') ?? '';
    c.setAttribute('title', REFRESHING);
  }, true);
  // Back to each control's own tooltip once the lock lifts.
  subscribeSnapshots(() => {
    if (snapshotLocked()) return;
    doc.querySelectorAll<HTMLElement>('[data-snapshot-title]').forEach(c => {
      const own = c.dataset.snapshotTitle;
      if (own) c.setAttribute('title', own); else c.removeAttribute('title');
      delete c.dataset.snapshotTitle;
    });
  });
}
