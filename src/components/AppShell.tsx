import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useScrollMemory } from '../lib/useScrollMemory';
import { useDevice } from '../lib/deviceClass';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { Logo } from './Logo';
import { RefreshLine } from './Loading';
import MobileTabBar, { TAB_BAR_HEIGHT } from './MobileTabBar';
import { PagePrimaryScope } from './States';
import { color, motion } from '../theme';

/** Persisted so the collapse choice survives a reload (BUTTONS §2, Writes = localStorage).
 *  Storage can throw (private mode, blocked cookies), so every access is guarded. */
const NAV_COLLAPSED_KEY = 'conts.shell.navCollapsed';

/** Tablets start on the 68px rail so content gets the width; an explicit choice always wins. */
function readNavOpen(defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(NAV_COLLAPSED_KEY);
    return v === null ? defaultOpen : v !== '1';
  } catch {
    return defaultOpen;
  }
}

function persistNavOpen(open: boolean) {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, open ? '0' : '1');
  } catch {
    /* storage unavailable — the choice simply won't survive reload */
  }
}

/** Subscribes to a media query. SSR-safe and re-renders on breakpoint change so
 *  the shell switches between the desktop column and the mobile drawer live. */
function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Owns the viewport: the shell clips, the sidebar and content scroll inside it.
 *  The login view sits OUTSIDE this component and scrolls as an ordinary page.
 *
 *  Desktop (>=768px): a fixed flex row — sidebar column + content — with the
 *  collapse choice persisted to localStorage, unchanged.
 *  Phone (<768px): the sidebar leaves the flow and becomes an overlay drawer, so
 *  main content is full-width on first load; a hamburger in a slim mobile header
 *  opens it. The desktop collapse/localStorage state is left untouched. */
export default function AppShell({
  path, navigate, children, action, flush,
}: { path: string; navigate: (p: string) => void; children: ReactNode; action?: { label: string; onClick: () => void };
  /** The content fills the area edge to edge and scrolls itself (the supply chain engine's frame). */
  flush?: boolean }) {
  // One device decision (src/lib/deviceClass.ts) replaces the 768px media query:
  // phone → drawer, tablet → rail by default, dual → shell on the first screen, desktop unchanged.
  const device = useDevice();
  const isNarrow = device.cls === 'phone';
  const [navOpen, setNavOpen] = useState(() => readNavOpen(device.cls !== 'tablet'));
  const toggleNav = () => setNavOpen(v => { const next = !v; persistNavOpen(next); return next; });
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The drawer is a phone-only concept: collapse it whenever we leave phone width
  // so it can never linger open behind the desktop layout.
  useEffect(() => { if (!isNarrow) setDrawerOpen(false); }, [isNarrow]);

  // Escape closes the open drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // The content area is the page's one scroller: it remembers where each list was, starts a new page at the top,
  // and takes the keyboard (PageUp/PageDown, arrows, Space) without a click first.
  const mainRef = useRef<HTMLElement>(null);
  useScrollMemory(mainRef, path);

  const drawerTransition = reduceMotion ? 'none' : `transform ${motion.standard} ${motion.ease}`;

  // On phone the drawer navigates AND closes; the sidebar's own chevron closes it.
  const drawerNavigate = (p: string) => { navigate(p); setDrawerOpen(false); };

  return (
    <div data-print-root data-device={device.cls} data-fold={device.fold} style={{ flex: 1, minWidth: 0, height: '100dvh', display: 'flex', overflow: 'hidden' }}>
      {isNarrow ? (
        <>
          {/* Scrim behind the open drawer. */}
          <div
            onClick={() => setDrawerOpen(false)}
            aria-hidden={!drawerOpen}
            style={{
              position: 'fixed', inset: 0, zIndex: 50, background: 'var(--color-surface-scrim)',
              opacity: drawerOpen ? 1 : 0,
              visibility: drawerOpen ? 'visible' : 'hidden',
              transition: reduceMotion ? 'none' : `opacity ${motion.standard} ${motion.ease}, visibility ${motion.standard} ${motion.ease}`,
            }}
          />
          {/* Off-canvas drawer. Out of flow, so main content is full-width on first load. */}
          <div
            role="dialog"
            aria-modal={drawerOpen}
            aria-label="Navigation"
            style={{
              position: 'fixed', top: 0, left: 0, height: '100dvh', zIndex: 51,
              transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: drawerTransition,
              boxShadow: drawerOpen ? '0 12px 32px 0 rgba(21,21,21,0.32)' : 'none',
              pointerEvents: drawerOpen ? 'auto' : 'none',
            }}
          >
            <Sidebar path={path} navigate={drawerNavigate} open phone onToggle={() => setDrawerOpen(false)} />
          </div>
        </>
      ) : (
        <Sidebar path={path} navigate={navigate} open={navOpen} onToggle={toggleNav} />
      )}

      <div data-print-root style={{ position: 'relative', flex: 1, minWidth: 0, height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <RefreshLine />
        {isNarrow && (
          // One row on phones: menu, logo, then search / bell / page action. The desk top bar's crumbs are
          // dropped here because each page's own title sits right below.
          // Installed on an iPhone the page draws under the clock and battery; the top padding clears them.
          <div data-print-hide style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(8px + env(safe-area-inset-top)) 16px 8px', background: color.card, borderBottom: `1px solid ${color.border}` }}>
            {/* Phones navigate from the bottom tab bar. */}
            <Logo variant="mark" size="sm" />
            <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, letterSpacing: '0.18em', color: color.ink }}>THE CONTS</span>
            <TopBar path={path} navigate={navigate} action={action} compact />
          </div>
        )}
        {!isNarrow && <TopBar path={path} navigate={navigate} action={action} />}
        {/* Phones get the standard 16px side gutter; the desk keeps its wider one. */}
        {/* The phone's bottom padding clears the home indicator / browser bar (safe area). */}
        <main ref={mainRef} data-app-main tabIndex={-1} className="app-main" style={{
          flex: 1, minHeight: 0, overflowY: flush ? 'hidden' : 'auto', overflowX: 'hidden', scrollbarGutter: flush ? 'auto' : undefined,
          padding: flush ? (isNarrow ? `0 0 calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` : 0) : isNarrow ? `16px 16px calc(${TAB_BAR_HEIGHT + 24}px + env(safe-area-inset-bottom))` : '24px 28px 40px',
          display: 'flex', flexDirection: 'column', gap: flush ? 0 : isNarrow ? 16 : 20,
        }}>
          <PagePrimaryScope path={path}>{children}</PagePrimaryScope>
        </main>
        {isNarrow && <MobileTabBar path={path} navigate={navigate} />}
      </div>
    </div>
  );
}
