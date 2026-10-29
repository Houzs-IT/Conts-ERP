import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { color, radius, text } from '../theme';
import { useSession } from '../lib/session';
import { usePortalLang, usePortalText, type PortalStrings } from '../lib/portalI18n';
import { Logo } from './Logo';
import Icon from './Icon';
import { FieldNotificationBell } from './NotificationBell';
import { jobTitle } from '../lib/vocabulary';

/** The portal's bottom bar. */
const TABS: { to: string; label: keyof PortalStrings['nav']; icon: string; match: (path: string) => boolean }[] = [
  { to: '/portal/today', label: 'jobs', icon: 'ClipboardList', match: p => !/^\/portal\/(clock|pay|me)/.test(p) },
  { to: '/portal/clock', label: 'clock', icon: 'Clock', match: p => p.startsWith('/portal/clock') },
  { to: '/portal/pay', label: 'pay', icon: 'Wallet', match: p => p.startsWith('/portal/pay') },
  { to: '/portal/me', label: 'me', icon: 'CircleUser', match: p => p.startsWith('/portal/me') },
];

/** Housekeepers and technicians work on a phone, in a car park, one-handed.
 *  One column, 44px targets, and the whole page scrolls normally. */
export default function FieldShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const path = useLocation().pathname;
  const atAccount = path === '/account';
  const lang = usePortalLang();
  const t = usePortalText();
  // The page's language follows the portal's, so screen readers and fonts read Chinese and Burmese right.
  useEffect(() => {
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = 'en'; };
  }, [lang]);
  return (
    <div style={{ flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: color.page }}>
      <header style={{
        flex: 'none', background: color.fillStrong, color: color.onFillStrong,
        padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <Logo variant="mark" size="sm" onDark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: text.copy, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.fullName}</span>
          <span style={{ fontSize: text.caption, color: color.dim }}>{jobTitle(user!)}</span>
        </div>
        <FieldNotificationBell />
        <Link to={atAccount ? '/portal/today' : '/account'} aria-label={atAccount ? t.nav.backToday : t.nav.settings} title={atAccount ? t.nav.backToday : t.nav.settings}
          style={{ width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control, border: '1px solid rgba(255,255,255,0.14)', color: color.onDark }}>
          <Icon name={atAccount ? 'House' : 'Settings'} size="nav" />
        </Link>
        {/* Log out sits at the bottom of Settings (AccountPage), never one mis-tap from the bell (owner, Oct 2026). */}
      </header>

      <main style={{ flex: 1, padding: atAccount ? '16px 16px 32px' : '16px 16px 96px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
        {children}
      </main>

      {/* Jobs, Clock, Pay and Me (HR phases 2 to 4). Hidden on Settings, which has its own way back. */}
      {!atAccount && (
        <nav aria-label={t.nav.portal} style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, display: 'grid', gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          background: color.card, borderTop: `1px solid ${color.border}`, paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {TABS.map(tab => {
            const on = tab.match(path);
            return (
              <Link key={tab.to} to={tab.to} aria-current={on ? 'page' : undefined}
                style={{ minHeight: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                  fontSize: text.caption, fontWeight: on ? 600 : 500, color: on ? color.ink : color.textMuted, textDecoration: 'none' }}>
                <Icon name={tab.icon} size="nav" />
                {t.nav[tab.label]}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
