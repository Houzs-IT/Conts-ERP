import { useState } from 'react';
import { color, radius } from '../theme';
import { screenClosed } from '../lib/navigation';
import { useSession } from '../lib/session';
import { ROLE_LABEL } from '../lib/vocabulary';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import Icon from './Icon';

/** Phone Settings tab (owner, Oct 2026). One place for the account and every system page;
 *  the More sheet keeps only daily modules. Rows the person cannot open are dropped.
 *  The audit trail lives inside System health in this codebase (/system/audit redirects there). */
const GROUPS: { label: string; items: { label: string; sub: string; icon: string; path: string }[] }[] = [
  { label: 'ACCOUNT', items: [
    { label: 'Company and defaults', sub: 'Name, address, SSM number, operator share', icon: 'Building2', path: '/system/settings#company' },
    { label: 'Profile and password', sub: 'Your name, phone, 2-step sign-in', icon: 'User', path: '/account' },
    { label: 'Notifications', sub: 'What you are told about, and when', icon: 'Bell', path: '/notifications' },
  ] },
  { label: 'SYSTEM', items: [
    { label: 'Users and roles', sub: 'Accounts, permissions, organisation chart', icon: 'ShieldCheck', path: '/system/users' },
    { label: 'Integrations', sub: 'Channex, email, WhatsApp, bank', icon: 'Plug', path: '/system/integrations' },
    { label: 'System health', sub: 'Status, problems and the audit trail', icon: 'Activity', path: '/system/health' },
  ] },
];

export default function MobileSettingsHub({ navigate }: { navigate: (p: string) => void }) {
  const { user, logout } = useSession();
  const [theme, setThemeState] = useState<ThemePref>(getThemePref);
  const setTheme = (p: ThemePref) => { setThemePref(p); setThemeState(p); };
  const [confirm, setConfirm] = useState(false);
  if (!user) return null;
  const initials = user.fullName.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const groups = GROUPS
    .map(g => ({ ...g, items: g.items.filter(it => !screenClosed(it.path.split('#')[0], user.access)) }))
    .filter(g => g.items.length);

  const row = { display: 'flex', alignItems: 'center', gap: 13, minHeight: 56, padding: '8px 16px', borderBottom: `1px solid ${color.borderMuted}`, background: 'transparent', border: 'none', width: '100%', textAlign: 'left' as const, cursor: 'pointer', color: color.ink };
  const label = { fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: color.textMuted } as const;
  const card = { borderRadius: 16, background: color.card, border: `1px solid ${color.border}`, overflow: 'hidden' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em' }}>Settings</h1>

      <button type="button" onClick={() => navigate('/account')} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: 16, cursor: 'pointer', textAlign: 'left', color: color.ink }}>
        <span style={{ width: 52, height: 52, flex: 'none', borderRadius: radius.pill, background: color.black, color: color.gold, display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 600 }}>{initials}</span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{user.fullName}</span>
          <span style={{ fontSize: 13, color: color.textMuted }}>{ROLE_LABEL[user.role] ?? user.role}</span>
        </span>
        <Icon name="ChevronRight" size="sm" color={color.faint} />
      </button>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={label}>APPEARANCE</span>
        <div role="radiogroup" aria-label="Appearance" style={{ display: 'flex', padding: 4, borderRadius: 14, background: color.muted }}>
          {(['light', 'dark'] as const).map(k => (
            <button key={k} type="button" role="radio" aria-checked={theme === k} onClick={() => setTheme(k)}
              style={{ flex: 1, height: 40, border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                background: theme === k ? color.card : 'transparent', color: theme === k ? color.ink : color.textMuted,
                boxShadow: theme === k ? '0 1px 2px rgba(21,21,21,0.08)' : 'none' }}>
              {k === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>

      {groups.map(g => (
        <section key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>{g.label}</span>
          <div style={card}>
            {g.items.map(it => (
              <button key={it.path} type="button" onClick={() => navigate(it.path)} style={row}>
                <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, display: 'grid', placeItems: 'center', background: color.goldTint, color: color.goldInk }}>
                  <Icon name={it.icon} size="sm" />
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 15 }}>{it.label}</span>
                  <span style={{ fontSize: 12, color: color.textMuted }}>{it.sub}</span>
                </span>
                <Icon name="ChevronRight" size="sm" color={color.faint} />
              </button>
            ))}
          </div>
        </section>
      ))}

      {!confirm ? (
        <button type="button" onClick={() => setConfirm(true)} style={{ height: 52, borderRadius: 14, border: `1px solid ${color.border}`, background: color.card, color: 'var(--color-danger)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Log out
        </button>
      ) : (
        <div role="alertdialog" aria-label="Log out" style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Log out of The Conts?</span>
          <span style={{ fontSize: 13, color: color.textMuted }}>You will need your password and 2-step code to sign in again.</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => setConfirm(false)} style={{ flex: 1, height: 44, borderRadius: radius.control, border: `1px solid ${color.border}`, background: color.card, color: color.ink, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={() => logout()} style={{ flex: 1, height: 44, borderRadius: radius.control, border: 'none', background: 'var(--color-danger)', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Log out</button>
          </div>
        </div>
      )}
      <span style={{ fontSize: 12, color: color.faint, textAlign: 'center' }}>The Conts Sdn Bhd · Property OS</span>
    </div>
  );
}
