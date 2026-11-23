// The pages this browser tab has open, as a row of tabs under the top bar (chew, 20 Nov 2026: like the 2990 system's
// "Payment Backdate Requests | Finance | Payment Requests | Sales report" strip). Each page is one tab, named as the top
// bar names it; the same page with another filter or tab (?query) keeps its one tab and the last query. A tab is closed
// with its x; past MAX the one used longest ago goes. sessionStorage, per browser tab, like the browser's own tabs.

export interface PageTab { path: string; title: string; at: number }

export const PAGE_TABS_KEY = 'conts.pageTabs.v1';
export const MAX_TABS = 12;

/** The page a tab stands for: the path without its query or hash, no trailing slash. */
export const pageOf = (p: string) => p.split('?')[0]!.split('#')[0]!.replace(/(.)\/+$/, '$1');

export function readTabs(): PageTab[] {
  try {
    const raw = sessionStorage.getItem(PAGE_TABS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter((t): t is PageTab => !!t && typeof t.path === 'string' && t.path.startsWith('/') && !t.path.startsWith('//') && typeof t.title === 'string')
        .map(t => ({ path: t.path, title: t.title, at: Number(t.at) || 0 }))
      : [];
  } catch {
    return [];
  }
}

export function writeTabs(tabs: PageTab[]) {
  try { sessionStorage.setItem(PAGE_TABS_KEY, JSON.stringify(tabs)); } catch { /* storage blocked: the row lives for this page only */ }
}

/** The row after visiting `path`: its page's tab takes the new query and title where it stands, or a new tab goes on
 *  the end; past MAX the tab used longest ago (never this one) goes. */
export function visit(tabs: PageTab[], path: string, title: string, now: number): PageTab[] {
  const page = pageOf(path);
  const i = tabs.findIndex(t => pageOf(t.path) === page);
  let next = i >= 0 ? tabs.map((t, j) => (j === i ? { path, title: title || t.title, at: now } : t)) : [...tabs, { path, title, at: now }];
  while (next.length > MAX_TABS) {
    const oldest = next.reduce((o, t, j) => (pageOf(t.path) !== page && (o < 0 || t.at < next[o]!.at) ? j : o), -1);
    if (oldest < 0) break;
    next = next.filter((_, j) => j !== oldest);
  }
  return next;
}

/** The row without `path`'s tab, and where to go when it was the open one: the tab to its right, else to its left. */
export function close(tabs: PageTab[], path: string, current: string): { tabs: PageTab[]; go: string | null } {
  const page = pageOf(path);
  const i = tabs.findIndex(t => pageOf(t.path) === page);
  if (i < 0) return { tabs, go: null };
  const rest = tabs.filter((_, j) => j !== i);
  if (pageOf(current) !== page) return { tabs: rest, go: null };
  const to = rest[i] ?? rest[i - 1] ?? null;
  return { tabs: rest, go: to ? to.path : '/' };
}
