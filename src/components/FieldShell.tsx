import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { color, radius, text } from '../theme';
import { useSession } from '../lib/session';
import { Logo } from './Logo';
import Icon from './Icon';
import { FieldNotificationBell } from './NotificationBell';
import { ROLE_LABEL } from '../lib/vocabulary';
import { humanize } from '../lib/format';

/** Housekeepers and technicians work on a phone, in a car park, one-handed.
 *  One column, 44px targets, and the whole page scrolls normally. */
export default function FieldShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const atAccount = useLocation().pathname === '/account';
  return (
    <div style={{ flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: color.page }}>
      <header style={{
        flex: 'none', background: color.black, color: 'var(--color-text-inverse)',
        padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <Logo variant="mark" size="sm" onDark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: text.copy, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.fullName}</span>
          <span style={{ fontSize: text.caption, color: color.dim }}>{ROLE_LABEL[user!.role] ?? humanize(user!.role)}</span>
        </div>
        <FieldNotificationBell />
        <a href={atAccount ? '#/' : '#/account'} aria-label={atAccount ? 'Back to today' : 'Settings'} title={atAccount ? 'Back to today' : 'Settings'}
          style={{ width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control, border: '1px solid rgba(255,255,255,0.14)', color: color.onDark }}>
          <Icon name={atAccount ? 'House' : 'Settings'} size="nav" />
        </a>
        {/* Log out sits at the bottom of Settings (AccountPage), never one mis-tap from the bell (owner, Oct 2026). */}
      </header>

      <main style={{ flex: 1, padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  );
}
