import { type ReactNode } from 'react';
import { color, radius, text } from '../theme';
import { useSession } from '../lib/session';
import { Logo } from './Logo';
import Icon from './Icon';

/** Owners get one page and no staff navigation: a dark bar, their name, log out. */
export default function OwnerShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  return (
    <div style={{ flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: color.page }}>
      <header style={{
        flex: 'none', background: color.black, color: '#FFFFFF',
        padding: '12px clamp(16px, 4vw, 32px)', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <Logo variant="mark" size="sm" onDark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: text.micro, fontWeight: 600, letterSpacing: '0.2em', color: color.gold }}>OWNER PORTAL</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.fullName}</span>
        </div>
        <button onClick={logout} aria-label="Log out"
          style={{ height: 44, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderRadius: radius.control, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: color.onDark, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>
          <Icon name="LogOut" size="nav" /><span>Log out</span>
        </button>
      </header>
      <main style={{ flex: 1, padding: 'clamp(16px, 3vw, 32px)', width: '100%', maxWidth: 1064, margin: '0 auto', boxSizing: 'border-box' }}>
        {children}
      </main>
    </div>
  );
}
