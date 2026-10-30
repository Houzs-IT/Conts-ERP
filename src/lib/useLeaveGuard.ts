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

// shortcut: one guard at a time. Two closing out of order leave a dead one on the navigator, stopping every move; make
// this a stack before a second form uses the hook.
let askOpenGuard: (() => Promise<boolean>) | null = null;

/** For a change made before the move, such as signing out, which a guard on the move itself would catch too late.
 *  True when nothing is unsaved or the person chose to leave; the guard then lets the move through. */
export async function confirmLeaving(): Promise<boolean> {
  return askOpenGuard?.() ?? true;
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
    const onPop = (e: PopStateEvent) => {
      const delta = historyIndex() - latest.current.index;
      if (delta === 0 || !leavesPlace(latest.current.location, window.location, latest.current.params)) return;
      // The browser has already moved: hide that from the router (capture runs first), step back, then ask.
      e.stopImmediatePropagation();
      window.history.go(-delta);
      void (async () => { if (await ask()) window.history.go(delta); })();
    };
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const release = () => {
      navigator.push = push;
      navigator.replace = replace;
      window.removeEventListener('popstate', onPop, { capture: true });
      window.removeEventListener('beforeunload', onUnload);
      askOpenGuard = null;
    };
    const ask = async () => {
      const leave = await latest.current.confirmLeave();
      if (leave) release();
      return leave;
    };
    const guarded = (go: Navigator['push']): Navigator['push'] => (...args) => {
      const [to] = args;
      if (!leavesPlace(window.location, typeof to === 'string' ? parsePath(to) : to, latest.current.params)) { go(...args); return; }
      void (async () => { if (await ask()) go(...args); })();
    };
    navigator.push = guarded(push);
    navigator.replace = guarded(replace);
    window.addEventListener('popstate', onPop, { capture: true });
    window.addEventListener('beforeunload', onUnload);
    askOpenGuard = ask;
    return release;
  }, [dirty, navigator]);
}
