import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import { Logo } from './Logo';
import Icon from './Icon';
import { Button } from './Button';
import { RefreshLine } from './Loading';
import { FieldNotificationBell } from './NotificationBell';

/** Owners get one page and no staff navigation: a calm website header (the approved v2 prototype's owner portal,
 *  screens/portals.js) with the brand, their name, notifications, settings and log out. */
export default function OwnerShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const atAccount = useLocation().pathname === '/account';
  return (
    <div className="relative flex-1 min-h-screen flex flex-col bg-page">
      <RefreshLine />
      <header className="sticky top-0 z-10 flex-none flex items-center gap-3.5 min-h-[60px] py-2 px-[clamp(16px,3vw,32px)] border-b border-solid border-line-soft backdrop-blur-[10px] [background:color-mix(in_srgb,var(--color-card)_92%,transparent)]">
        <Link to="/" aria-label="My owner portal" className="flex items-center gap-2.5 flex-none no-underline">
          <Logo variant="mark" size="sm" />
          <span className="max-sm:hidden font-[Georgia,'Times_New_Roman',serif] text-heading tracking-[0.2em] text-gold-ink font-semibold">THE CONTS</span>
        </Link>
        <span className="max-sm:hidden flex-none rounded-full bg-gold-soft text-gold-ink text-caption font-bold tracking-[0.16em] px-2 py-[3px]">OWNER</span>
        <div className="flex flex-col gap-px flex-1 min-w-0 items-end text-right">
          {/* Up to two lines, so a long or joint name is read whole on a phone instead of cut to "Lim Chee ...". */}
          <span className="line-clamp-2 [overflow-wrap:anywhere] leading-tight text-copy font-semibold text-ink">{user!.fullName}</span>
          <span className="text-meta text-muted-ink max-sm:hidden">Owner portal</span>
        </div>
        {/* A repair quote waiting for their approval reaches them here, not only on the next visit to the portal. */}
        <FieldNotificationBell />
        <Link to={atAccount ? '/' : '/account'} aria-label={atAccount ? 'Back to my portal' : 'Settings'} title={atAccount ? 'Back to my portal' : 'Settings'}
          className="w-11 h-11 flex-none grid place-items-center rounded-control border border-solid border-line text-ink-2 hover:border-gold hover:text-gold-ink">
          <Icon name={atAccount ? 'House' : 'Settings'} size="nav" />
        </Link>
        <Button variant="secondary" size="touch" onClick={logout} icon={<Icon name="LogOut" size="nav" />} style={{ flex: 'none' }}>
          {/* On a phone the word gives way to the owner's own name; the icon and the button's name stay. */}
          <span className="max-[479px]:sr-only">Log out</span>
        </Button>
      </header>
      <main className="flex-1 w-full max-w-[1240px] min-[1700px]:max-w-[1560px] mx-auto box-border p-[clamp(16px,3vw,32px)]">
        {children}
      </main>
    </div>
  );
}
