import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

/** Owns the viewport: the shell clips, the sidebar and content scroll inside it.
 *  The login view sits OUTSIDE this component and scrolls as an ordinary page. */
export default function AppShell({
  path, navigate, children, action,
}: { path: string; navigate: (p: string) => void; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  const [navOpen, setNavOpen] = useState(true);
  return (
    <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'flex', overflow: 'hidden' }}>
      <Sidebar path={path} navigate={navigate} open={navOpen} onToggle={() => setNavOpen(v => !v)} />
      <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar path={path} action={action} />
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
