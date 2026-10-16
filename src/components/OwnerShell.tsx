import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { color, text } from '../theme';
import { useSession } from '../lib/session';
import { Logo } from './Logo';
import Icon from './Icon';
import { Button } from './Button';
import { Eyebrow } from './Metric';
import { RefreshLine } from './Loading';
import { FieldNotificationBell } from './NotificationBell';

/** Owners get one page and no staff navigation: a dark bar, their name, log out. */
export default function OwnerShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const atAccount = useLocation().pathname === '/account';
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: color.page }}>
      <RefreshLine />
      <header style={{
        flex: 'none', background: color.black, color: 'var(--color-text-inverse)',
        padding: '12px clamp(16px, 4vw, 32px)', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <Logo variant="mark" size="sm" onDark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <Eyebrow className="text-gold!">Owner portal</Eyebrow>
          {/* Up to two lines, so a long or joint name is read whole on a phone instead of cut to "Lim Chee ...". */}
          <span className="line-clamp-2 [overflow-wrap:anywhere] leading-tight" style={{ fontSize: text.copy, fontWeight: 600 }}>{user!.fullName}</span>
        </div>
        {/* A repair quote waiting for their approval reaches them here, not only on the next visit to the portal. */}
        <FieldNotificationBell />
        <a href={atAccount ? '#/' : '#/account'} aria-label={atAccount ? 'Back to my portal' : 'My account'} title={atAccount ? 'Back to my portal' : 'My account'}
          style={{ width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-control)', border: '1px solid rgba(255,255,255,0.14)', color: color.onDark }}>
          <Icon name={atAccount ? 'House' : 'ShieldCheck'} size="nav" />
        </a>
        <Button variant="tertiary" size="touch" onClick={logout} icon={<Icon name="LogOut" size="nav" />}
          style={{ flex: 'none', fontSize: text.copy, color: color.onDark, borderColor: 'rgba(255,255,255,0.14)' }}>
          {/* On a phone the word gives way to the owner's own name; the icon and the button's name stay. */}
          <span className="max-[479px]:sr-only">Log out</span>
        </Button>
      </header>
      <main style={{ flex: 1, padding: 'clamp(16px, 3vw, 32px)', width: '100%', maxWidth: 1064, margin: '0 auto', boxSizing: 'border-box' }}>
        {children}
      </main>
    </div>
  );
}
