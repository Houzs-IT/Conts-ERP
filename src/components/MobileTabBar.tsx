import { useMemo, useState } from 'react';
import { color, motion, radius } from '../theme';
import { navFor, screenClosed } from '../lib/navigation';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import Icon, { toPascal } from './Icon';

/** Phone bottom navigation (owner, Oct 2026): Dashboard, Calendar, More, Reservations, Settings.
 *  More sits in the centre as a raised round button and opens every module, grouped
 *  exactly like the desktop sidebar. Tabs the person cannot open are dropped, never disabled. */
const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', path: '/' },
  { key: 'calendar', label: 'Calendar', icon: 'CalendarDays', path: '/reservations/calendar' },
  { key: 'more', label: 'More', icon: 'LayoutGrid', path: '' },
  { key: 'bookings', label: 'Bookings', icon: 'BookOpen', path: '/reservations/bookings' },
  { key: 'settings', label: 'Settings', icon: 'Settings', path: '/settings' },
] as const;

export const TAB_BAR_HEIGHT = 64;

export default function MobileTabBar({ path, navigate }: { path: string; navigate: (p: string) => void }) {
  const { user } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = TABS.filter(t => t.key === 'more' || t.key === 'settings' || !screenClosed(t.path, user?.access));
  const onTab = (p: string) => p === '/' ? path === '/' : p === '/settings' ? (path === '/settings' || path.startsWith('/system') || path === '/account') : path.startsWith(p);

  return (
    <>
      <nav aria-label="Main" data-print-hide style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
        height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex', alignItems: 'stretch', background: color.card, borderTop: `1px solid ${color.border}`,
      }}>
        {tabs.map(t => {
          if (t.key === 'more') {
            return (
              <div key={t.key} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <button type="button" onClick={() => setMoreOpen(true)} aria-label="All modules" aria-expanded={moreOpen}
                  style={{
                    width: 54, height: 54, marginTop: -16, flex: 'none', borderRadius: radius.pill, border: `4px solid ${color.card}`,
                    background: color.black, color: color.gold, display: 'grid', placeItems: 'center', cursor: 'pointer',
                    boxShadow: '0 6px 16px rgba(21,21,21,0.24)',
                  }}>
                  <Icon name="LayoutGrid" size="base" />
                </button>
              </div>
            );
          }
          const on = onTab(t.path);
          return (
            <button key={t.key} type="button" onClick={() => navigate(t.path)} aria-current={on ? 'page' : undefined}
              style={{
                flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                border: 'none', background: 'transparent', cursor: 'pointer', color: on ? color.ink : color.textMuted,
                fontSize: 11, fontWeight: on ? 600 : 500,
              }}>
              <Icon name={t.icon} size="base" color={on ? color.goldInk : 'currentColor'} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
      {moreOpen && <MoreSheet path={path} onClose={() => setMoreOpen(false)} navigate={p => { setMoreOpen(false); navigate(p); }} />}
    </>
  );
}

/** Every module the person can open, grouped like the desktop sidebar, with a search box. */
function MoreSheet({ path, navigate, onClose }: { path: string; navigate: (p: string) => void; onClose: () => void }) {
  const { user } = useSession();
  const engine = useApi<{ enabled: boolean }>('/supply-chain/engine');
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const all = navFor(user!.role, !!engine.data?.enabled, user!.access);
    const needle = q.trim().toLowerCase();
    // System pages live under the Settings tab on phones, so More keeps the daily modules only.
    return all
      .filter(g => g.label !== 'SYSTEM')
      .map(g => ({
        label: g.label,
        items: g.items.flatMap(it => it.children?.length
          ? it.children.map(c => ({ key: c.key, label: c.label, path: c.path, icon: it.icon }))
          : it.path ? [{ key: it.key, label: it.label, path: it.path, icon: it.icon }] : [])
          .filter(it => !needle || it.label.toLowerCase().includes(needle)),
      }))
      .filter(g => g.items.length);
  }, [user, engine.data?.enabled, q]);

  return (
    <div role="dialog" aria-modal aria-label="All modules" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--color-surface-scrim)' }} />
      <div style={{
        position: 'relative', maxHeight: '86dvh', display: 'flex', flexDirection: 'column', background: color.page,
        borderRadius: '20px 20px 0 0', paddingBottom: 'env(safe-area-inset-bottom)',
        animation: `sheet-up ${motion.slow} ${motion.ease} both`,
      }}>
        <div style={{ width: 38, height: 4, borderRadius: radius.pill, background: color.border, margin: '10px auto 4px' }} />
        <div style={{ padding: '8px 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 14px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: color.card, color: color.textMuted }}>
            <Icon name="Search" size="sm" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a module" aria-label="Find a module"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: color.ink }} />
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', border: `1px solid ${color.border}`, borderRadius: radius.control, background: color.card, color: color.ink, cursor: 'pointer' }}>
            <Icon name="X" size="base" />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groups.map(g => (
            <section key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.13em', color: color.textMuted }}>{g.label}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {g.items.map(it => {
                  const on = path === it.path;
                  return (
                    <button key={it.key} type="button" onClick={() => navigate(it.path)}
                      style={{
                        minHeight: 78, padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7,
                        borderRadius: radius.card, cursor: 'pointer', textAlign: 'center',
                        border: `1px solid ${on ? color.gold : color.border}`, background: on ? color.goldTint : color.card, color: color.ink,
                      }}>
                      <Icon name={toPascal(it.icon)} size="base" color={color.goldInk} />
                      <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.25 }}>{it.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {!groups.length && <span style={{ fontSize: 13, color: color.textMuted, textAlign: 'center', padding: '24px 0' }}>No module matches “{q}”.</span>}
        </div>
      </div>
    </div>
  );
}
