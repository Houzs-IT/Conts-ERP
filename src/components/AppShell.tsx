import { useRef, useState, type ReactNode } from 'react';
import { useScrollMemory } from '../lib/useScrollMemory';
import { useDevice } from '../lib/deviceClass';
import Sidebar, { useDarkTheme } from './Sidebar';
import TopBar from './TopBar';
import { Logo } from './Logo';
import { RefreshLine } from './Loading';
import MobileTabBar, { TAB_BAR_HEIGHT } from './MobileTabBar';
import { PagePrimaryScope } from './States';
import { color, dcGlass } from '../theme';
import { workspaceOf } from '../lib/navigation';

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

/** Owns the viewport: the shell clips, the sidebar and content scroll inside it.
 *  The login view sits OUTSIDE this component and scrolls as an ordinary page.
 *
 *  Tablet and desktop: a fixed flex row, sidebar column + content, with the
 *  collapse choice persisted to localStorage.
 *  Phone: no sidebar; a slim header on top and the bottom tab bar (MobileTabBar). */
export default function AppShell({
  path, navigate, children, action, flush,
}: { path: string; navigate: (p: string) => void; children: ReactNode; action?: { label: string; onClick: () => void };
  /** The content fills the area edge to edge and scrolls itself (the supply chain engine's frame). */
  flush?: boolean }) {
  // One device decision (src/lib/deviceClass.ts) replaces the 768px media query:
  // phone → tab bar, tablet → rail by default, dual → shell on the first screen, desktop unchanged.
  const device = useDevice();
  const isNarrow = device.cls === 'phone';
  const [navOpen, setNavOpen] = useState(() => readNavOpen(device.cls !== 'tablet'));
  const toggleNav = () => setNavOpen(v => { const next = !v; persistNavOpen(next); return next; });

  // The content area is the page's one scroller: it remembers where each list was, starts a new page at the top,
  // and takes the keyboard (PageUp/PageDown, arrows, Space) without a click first.
  const mainRef = useRef<HTMLElement>(null);
  useScrollMemory(mainRef, path);
  // A supply chain screen is Dream Crafter's side: the phone header shows its logo there, as the sidebar does.
  const dc = workspaceOf(path) === 'supply';
  // The Beta screens paint the glass backdrop in their frame; painting the same one behind the top bar lets it float
  // over the page as the designs draw it, with no seam where the frame starts.
  const dark = useDarkTheme();
  const betaBackdrop = path.startsWith('/beta') && !isNarrow ? dcGlass[dark ? 'dark' : 'light'].page : undefined;

  return (
    <div data-print-root data-device={device.cls} data-fold={device.fold} style={{ flex: 1, minWidth: 0, height: '100dvh', display: 'flex', overflow: 'hidden' }}>
      {/* Phones navigate from the bottom tab bar and its menu sheet; there is no sidebar there. */}
      {!isNarrow && <Sidebar path={path} navigate={navigate} open={navOpen} onToggle={toggleNav} />}

      <div data-print-root style={{ position: 'relative', flex: 1, minWidth: 0, height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: betaBackdrop, backgroundAttachment: betaBackdrop ? 'fixed' : undefined }}>
        <RefreshLine />
        {isNarrow && (
          // One row on phones: menu, logo, then search / bell / page action. The desk top bar's crumbs are
          // dropped here because each page's own title sits right below.
          // Installed on an iPhone the page draws under the clock and battery; the top padding clears them.
          <div data-print-hide style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(8px + env(safe-area-inset-top)) 16px 8px', background: color.card, borderBottom: `1px solid ${color.border}` }}>
            {/* Phones navigate from the bottom tab bar. */}
            <Logo variant="mark" size="sm" brand={dc ? 'dreamCrafter' : 'theConts'} />
            <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, letterSpacing: dc ? '0.08em' : '0.18em', color: color.ink }}>{dc ? 'DREAM CRAFTER' : 'THE CONTS'}</span>
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
