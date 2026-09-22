import { useEffect, useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Icon from './Icon';
import { Logo } from './Logo';
import { color, radius, shell, motion } from '../theme';

/** Persisted so the collapse choice survives a reload (BUTTONS §2, Writes = localStorage).
 *  Storage can throw (private mode, blocked cookies), so every access is guarded. */
const NAV_COLLAPSED_KEY = 'conts.shell.navCollapsed';

function readNavOpen(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) !== '1';
  } catch {
    return true;
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
  path, navigate, children, action,
}: { path: string; navigate: (p: string) => void; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  const [navOpen, setNavOpen] = useState(readNavOpen);
  const toggleNav = () => setNavOpen(v => { const next = !v; persistNavOpen(next); return next; });

  const isNarrow = useMediaQuery('(max-width: 767.98px)');
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

  const drawerTransition = reduceMotion ? 'none' : `transform ${motion.standard} ${motion.ease}`;

  // On phone the drawer navigates AND closes; the sidebar's own chevron closes it.
  const drawerNavigate = (p: string) => { navigate(p); setDrawerOpen(false); };

  return (
    <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'flex', overflow: 'hidden' }}>
      {isNarrow ? (
        <>
          {/* Scrim behind the open drawer. */}
          <div
            onClick={() => setDrawerOpen(false)}
            aria-hidden={!drawerOpen}
            style={{
              position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(21,21,21,0.44)',
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
              position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 51,
              transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: drawerTransition,
              boxShadow: drawerOpen ? '0 12px 32px 0 rgba(21,21,21,0.32)' : 'none',
              pointerEvents: drawerOpen ? 'auto' : 'none',
            }}
          >
            <Sidebar path={path} navigate={drawerNavigate} open onToggle={() => setDrawerOpen(false)} />
          </div>
        </>
      ) : (
        <Sidebar path={path} navigate={navigate} open={navOpen} onToggle={toggleNav} />
      )}

      <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {isNarrow && (
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#FFFFFF', borderBottom: `1px solid ${color.border}` }}>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              style={{ width: shell.controlTouch, height: shell.controlTouch, flex: 'none', display: 'grid', placeItems: 'center', border: `1px solid ${color.border}`, borderRadius: radius.control, background: '#FFFFFF', color: color.ink, cursor: 'pointer' }}
            >
              <Icon name="Menu" size="base" />
            </button>
            <Logo variant="full" size="sm" />
          </div>
        )}
        <TopBar path={path} navigate={navigate} action={action} />
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
