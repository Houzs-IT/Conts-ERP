import { useEffect, useMemo, useState } from 'react';
import { color, radius } from '../theme';
import { navFor, screenClosed, workspaceOf, WORKSPACE_LABEL, type BadgeKey, type Workspace } from '../lib/navigation';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { useNavCounts } from '../lib/navBadges';
import Icon, { toPascal } from './Icon';
import { Logo } from './Logo';
import { activeKey, readWs, saveWs, withoutOffItems } from './Sidebar';
import { count as countLabel } from '../lib/format';

/** Phone bottom navigation (owner, Oct 2026): Dashboard, Calendar, More, Reservations, Settings.
 *  More sits in the centre as a raised round button and opens every module, grouped
 *  exactly like the desktop sidebar. Tabs the person cannot open are dropped, never disabled. */
const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', path: '/' },
  { key: 'calendar', label: 'Calendar', icon: 'CalendarDays', path: '/reservations/calendar' },
  { key: 'more', label: 'More', icon: '', path: '' },
  { key: 'bookings', label: 'Reservations', icon: 'BookOpen', path: '/reservations/bookings' },
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
                    background: color.fillStrong, color: color.gold, display: 'grid', placeItems: 'center', cursor: 'pointer',
                    boxShadow: `0 6px 16px rgba(21,21,21,0.24), 0 0 0 1.5px ${color.fillRing}`,
                  }}>
                  {/* The company mark, as at the top left: a grid read as a QR scanner and three lines as a page menu. */}
                  <Logo variant="mark" size="sm" onDark />
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

type MenuRow = { key: string; label: string; icon: string; path: string; count: number };
type MenuSection = { key: string; label: string; rows: MenuRow[] };

/** Every module the person can open, as a flat list of labelled cards (phone design, owner Oct 2026): no row
 *  opens or closes. A desktop category (Sales order, Procurement...) becomes its own card with its own label, and
 *  each of its screens is a row with its own icon. System pages live under Settings. */
function MoreSheet({ path, navigate, onClose }: { path: string; navigate: (p: string) => void; onClose: () => void }) {
  const { user } = useSession();
  const engine = useApi<{ enabled: boolean }>('/supply-chain/engine');
  const counts = useNavCounts(path);
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Same Rental / Supply chain split as the desktop sidebar, sharing its saved choice.
  const [ws, setWs] = useState<Workspace>(() => workspaceOf(path) ?? readWs());
  const pick = (w: Workspace) => { setWs(w); saveWs(w); };
  // System pages live under Settings, except IT Support, which every desk role needs: on the rental side it gets
  // the same SUPPORT card as on the supply chain side.
  // Groups marked phone: false (Finance, owner 11 Oct 2026) stay off the phone; switched-off items stay off as on the desk.
  const all = useMemo(() => withoutOffItems(navFor(user!.role, !!engine.data?.enabled, user!.access), counts?.approvalsOn === true)
    .filter(g => g.phone !== false)
    .map(g => g.workspace === 'rental' && g.label === 'SYSTEM' ? { ...g, label: 'SUPPORT', items: g.items.filter(it => it.key === 'itSupport') } : g),
  [user, engine.data?.enabled, counts?.approvalsOn]);
  // Highlights the row a record or sub-page belongs to, the same rule as the desk sidebar.
  const current = useMemo(() => activeKey(all, path), [all, path]);
  const hasSupply = all.some(g => g.workspace === 'supply');
  const sections = useMemo((): MenuSection[] => {
    const needle = q.trim().toLowerCase();
    const n = (b?: BadgeKey) => (b ? Number(counts?.[b] ?? 0) : 0);
    // A search looks through both sides: people should not need to know which one a module lives in.
    // Matching a category's own name shows all of its screens.
    const hit = (label: string) => !needle || label.toLowerCase().includes(needle);
    return all
      .filter(g => needle || !hasSupply || g.workspace === ws)
      .flatMap(g => {
        const out: MenuSection[] = [];
        let loose: MenuRow[] = [];
        const flush = () => { if (loose.length) out.push({ key: `${g.workspace}:${g.label}:${out.length}`, label: g.label, rows: loose }); loose = []; };
        // A search lists IT Support once: the supply chain copy of it is left out.
        for (const it of g.items.filter(i => !(needle && i.key === 'itSupportSupply'))) {
          if (it.children?.length) {
            flush();
            const rows = it.children.filter(c => hit(it.label) || hit(c.label))
              .map(c => ({ key: c.key, label: c.label, icon: c.icon ?? it.icon, path: c.path, count: n(c.badge) }));
            if (rows.length) out.push({ key: it.key, label: it.label.toUpperCase(), rows });
          } else if (it.path && hit(it.label)) {
            loose.push({ key: it.key, label: it.label, icon: it.icon, path: it.path, count: n(it.badge) });
          }
        }
        flush();
        return out;
      });
  }, [all, hasSupply, ws, q, counts]);


  return (
    <div role="dialog" aria-modal aria-label="All modules" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--color-surface-scrim)' }} />
      <div style={{
        position: 'relative', maxHeight: '88dvh', display: 'flex', flexDirection: 'column', background: color.page,
        borderRadius: '22px 22px 0 0', paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ width: 38, height: 4, borderRadius: radius.pill, background: color.border, margin: '10px auto 4px' }} />
        <div style={{ padding: '8px 18px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: color.ink }}>More</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', border: `1px solid ${color.border}`, borderRadius: radius.pill, background: color.card, color: color.ink, cursor: 'pointer' }}>
            <Icon name="X" size="base" />
          </button>
        </div>
        {hasSupply && (
          <div role="tablist" aria-label="Workspace" style={{ margin: '8px 18px 0', padding: 3, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, borderRadius: 14, border: `1px solid ${color.border}`, background: color.card }}>
            {(['rental', 'supply'] as Workspace[]).map(w => (
              <button key={w} type="button" role="tab" aria-selected={ws === w} onClick={() => pick(w)}
                style={{ height: 40, borderRadius: 11, border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600,
                  background: ws === w ? color.fillStrong : 'transparent', color: ws === w ? color.onFillStrong : color.textMuted }}>
                {WORKSPACE_LABEL[w]}
              </button>
            ))}
          </div>
        )}
        <div style={{ padding: '8px 18px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 14px', borderRadius: 14, border: `1px solid ${color.border}`, background: color.card, color: color.textMuted }}>
            <Icon name="Search" size="sm" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a module" aria-label="Find a module"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, color: color.ink }} />
          </div>
        </div>
        {/* .menu-sheet: hover and press washes in styles/hover.css. */}
        <div className="menu-sheet" style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '2px 16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sections.map(sec => (
            <section key={sec.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', color: color.textMuted }}>{sec.label}</span>
              <div style={{ borderRadius: 16, background: color.card, border: `1px solid ${color.border}`, overflow: 'hidden' }}>
                {sec.rows.map((r, i) => {
                  const on = r.key === current;
                  return (
                    <button key={r.key} type="button" onClick={() => navigate(r.path)} aria-current={on ? 'page' : undefined}
                      style={{
                        width: '100%', minHeight: 46, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 11,
                        border: 'none', borderTop: i ? `1px solid ${color.borderMuted}` : 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit',
                        background: on ? color.goldTint : 'transparent', color: color.ink,
                      }}>
                      <span style={{ width: 28, height: 28, flex: 'none', borderRadius: 8, display: 'grid', placeItems: 'center', background: color.goldTint }}>
                        <Icon name={toPascal(r.icon)} size="sm" color={color.goldInk} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: on ? 600 : 400 }}>{r.label}</span>
                      {r.count > 0 && (
                        <span style={{ minWidth: 24, height: 24, padding: '0 8px', borderRadius: radius.pill, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', background: color.ink, color: color.card }}>{countLabel(r.count)}</span>
                      )}
                      <Icon name="ChevronRight" size="sm" color={color.textMuted} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {!sections.length && <span style={{ fontSize: 14, color: color.textMuted, textAlign: 'center', padding: '24px 0' }}>No module matches “{q}”.</span>}
        </div>
      </div>
    </div>
  );
}
