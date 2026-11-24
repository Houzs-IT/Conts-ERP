import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * The Meetings count on the menu: invites, changes and cancellations the person has not seen yet (IT Hub notices).
 * Its own request, like IT Support's (lib/itSupport.ts), so the menu's other counts never wait on another system.
 * One shared request per minute for the whole shell, only while the tab is looked at; any failure shows no count.
 */
let unread = 0;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(n: number) => void>();

/** The count in the relay's answer ({ count }), never negative or garbage. */
export function meetingsCount(r: unknown): number {
  const n = Number((r as { count?: unknown } | null)?.count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function load(force = false) {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < 15_000) return Promise.resolve();
  inflight = api.get<{ count: number }>('/meetings/unread-count')
    .then(r => { unread = meetingsCount(r); })
    .catch(() => { unread = 0; })
    .finally(() => { listeners.forEach(l => l(unread)); fetchedAt = Date.now(); inflight = null; });
  return inflight;
}

/** Call after My meetings marked the updates read. */
export function refreshMeetingsUnread() { void load(true); }

let timer: number | undefined;
const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
export function useMeetingsUnread(): number {
  const [n, setN] = useState(unread);
  useEffect(() => {
    listeners.add(setN);
    if (listeners.size === 1) {
      timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 60_000);
      document.addEventListener('visibilitychange', onVisible);
    }
    void load();
    return () => { listeners.delete(setN); if (listeners.size === 0) { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); } };
  }, []);
  return n;
}
