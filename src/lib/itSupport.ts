import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * The IT Support count on the menu: how many of the person's IT requests IT has answered since they last opened
 * them. It is its own request, not part of /api/nav/badges, because it asks the IT Hub, and the menu's other counts
 * must not wait on (or fail with) another system. One shared request per minute for the whole shell, only while the
 * tab is looked at. Any failure (not connected, hub down) leaves the last known count as it is.
 */
let unread = 0;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(n: number) => void>();

function load(force = false) {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < 15_000) return Promise.resolve();
  inflight = api.get<{ unread: number }>('/it-support/unread-count')
    .then(r => { unread = Number(r?.unread) || 0; listeners.forEach(l => l(unread)); })
    .catch(() => {})
    .finally(() => { fetchedAt = Date.now(); inflight = null; });
  return inflight;
}

let lastPage = '';
/** The menu calls this on every move, so a new request can say which screen the problem was on. */
export function rememberPage(path: string) {
  if (!path.endsWith('/it-support')) lastPage = path;
}
/** The screen the person was on before IT Support, as a full address IT can open, or '' if none. */
export function pageBeforeItSupport() {
  return lastPage ? `${window.location.origin}/#${lastPage}` : '';
}

/** Call after opening a request or sending a reply: the count has just changed. */
export function refreshItUnread() { void load(true); }

let timer: number | undefined;
const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
export function useItUnread(): number {
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
