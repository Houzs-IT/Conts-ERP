import { useEffect, useState } from 'react';
import { api } from './api';
import type { BadgeKey } from './navigation';

export interface NavCounts extends Partial<Record<BadgeKey, number>> {
  channels?: { units: number; lastSentAt: string | null; failed: number };
  /** Whether money actions wait for a second person (Settings > Approvals). */
  approvalsOn?: boolean;
  /** What the bell lists: the same live events that drive the menu counts. */
  alerts?: { key: string; title: string; body: string; target: string; tone: 'critical' | 'warning' | 'info'; count: number }[];
}

/**
 * One shared /api/nav/badges request for the whole shell. The sidebar, the phone drawer and the top bar
 * all read this store, so a page load asks once (it used to ask three or four times). It refreshes every
 * 60 seconds, and on a page change when the last answer is older than 15 seconds, so a count still drops
 * soon after the work is done.
 */
let state: NavCounts | null = null;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(s: NavCounts | null) => void>();

function load(force = false) {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < 15_000) return Promise.resolve();
  inflight = api.get<NavCounts>('/nav/badges')
    .then(r => { state = r; fetchedAt = Date.now(); listeners.forEach(l => l(state)); })
    .catch(() => { fetchedAt = Date.now(); })
    .finally(() => { inflight = null; });
  return inflight;
}

let timer: number | undefined;
export function useNavCounts(path?: string): NavCounts | null {
  const [s, setS] = useState<NavCounts | null>(state);
  useEffect(() => {
    listeners.add(setS);
    if (listeners.size === 1) timer = window.setInterval(() => { void load(true); }, 60_000);
    return () => { listeners.delete(setS); if (listeners.size === 0) window.clearInterval(timer); };
  }, []);
  useEffect(() => { void load(); }, [path]);
  return s;
}

/** After an action that changes a count (a statement sent, a job closed), ask again straight away. */
export const refreshNavCounts = () => load(true);
