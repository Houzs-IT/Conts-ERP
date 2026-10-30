import { useContext, useEffect, useRef } from 'react';
import { UNSAFE_NavigationContext, parsePath, useLocation, type Navigator } from 'react-router-dom';

export interface Place { pathname: string; search: string }

/** Whether an address is somewhere else: another page, or another value of a `params` entry. Any other part of the
 *  address, such as a search box or a filter, stays in the same place. */
export function leavesPlace(from: Place, to: Partial<Place>, params: readonly string[]): boolean {
  if (to.pathname && to.pathname !== from.pathname) return true;
  const a = new URLSearchParams(from.search), b = new URLSearchParams(to.search ?? '');
  return params.some(k => a.get(k) !== b.get(k));
}

/** Where this address sits in the browser's history (React Router writes it there). */
function historyIndex(): number {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && 'idx' in state && typeof state.idx === 'number' ? state.idx : 0;
}

/**
 * While `dirty`, asks before the address moves to another place, by link, sidebar, code or the browser's back button,
 * and has the browser ask before a reload or a closed tab. `confirmLeave` resolves true to go on, and drops the edits
 * when it does. The app runs on BrowserRouter, which has no useBlocker (App.tsx says why), so this wraps its navigator.
 */
export function useLeaveGuard(dirty: boolean, confirmLeave: () => Promise<boolean>, params: readonly string[] = []): void {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const latest = useRef({ confirmLeave, params, location, index: 0 });
  useEffect(() => { latest.current = { confirmLeave, params, location, index: historyIndex() }; });

  useEffect(() => {
    if (!dirty) return;
    const { push, replace } = navigator;
    const guarded = (go: Navigator['push']): Navigator['push'] => (...args) => {
      const [to] = args;
      if (!leavesPlace(window.location, typeof to === 'string' ? parsePath(to) : to, latest.current.params)) { go(...args); return; }
      void (async () => { if (await latest.current.confirmLeave()) go(...args); })();
    };
    navigator.push = guarded(push);
    navigator.replace = guarded(replace);

    let passing = false;
    const onPop = (e: PopStateEvent) => {
      const delta = historyIndex() - latest.current.index;
      if (passing || delta === 0 || !leavesPlace(latest.current.location, window.location, latest.current.params)) return;
      // The browser has already moved: hide that from the router (capture runs first), step back, then ask.
      e.stopImmediatePropagation();
      window.history.go(-delta);
      void (async () => {
        if (!await latest.current.confirmLeave()) return;
        passing = true;
        window.history.go(delta);
      })();
    };
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('popstate', onPop, { capture: true });
    window.addEventListener('beforeunload', onUnload);
    return () => {
      navigator.push = push;
      navigator.replace = replace;
      window.removeEventListener('popstate', onPop, { capture: true });
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty, navigator]);
}
