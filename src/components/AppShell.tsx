import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

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

/** Owns the viewport: the shell clips, the sidebar and content scroll inside it.
 *  The login view sits OUTSIDE this component and scrolls as an ordinary page. */
export default function AppShell({
  path, navigate, children, action,
}: { path: string; navigate: (p: string) => void; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  const [navOpen, setNavOpen] = useState(readNavOpen);
  const toggleNav = () => setNavOpen(v => { const next = !v; persistNavOpen(next); return next; });
  return (
    <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'flex', overflow: 'hidden' }}>
      <Sidebar path={path} navigate={navigate} open={navOpen} onToggle={toggleNav} />
      <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar path={path} navigate={navigate} action={action} />
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
