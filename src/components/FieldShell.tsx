import { type ReactNode } from 'react';
import { color, radius, text } from '../theme';
import { useSession } from '../lib/session';
import { Logo } from './Logo';
import Icon from './Icon';

/** Housekeepers and technicians work on a phone, in a car park, one-handed.
 *  One column, 44px targets, and the whole page scrolls normally. */
export default function FieldShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  return (
    <div style={{ flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: color.page }}>
      <header style={{
        flex: 'none', background: color.black, color: '#FFFFFF',
        padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <Logo variant="mark" size="sm" onDark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.fullName}</span>
          <span style={{ fontSize: text.micro, color: color.dim, textTransform: 'capitalize' }}>{user!.role.replace(/_/g, ' ')}</span>
        </div>
        <button onClick={logout} aria-label="Log out"
          style={{ width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: color.onDark, cursor: 'pointer' }}>
          <Icon name="LogOut" size="nav" />
        </button>
      </header>

      <main style={{ flex: 1, padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560, width: '100%', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  );
}
