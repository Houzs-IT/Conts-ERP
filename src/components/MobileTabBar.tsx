import { useEffect, useMemo, useState } from 'react';
import { color, radius } from '../theme';
import { navFor, workspaceOf, WORKSPACE_LABEL, type BadgeKey, type NavGroup, type NavItem, type Workspace } from '../lib/navigation';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { useNavCounts } from '../lib/navBadges';
import Icon, { toPascal } from './Icon';
import { activeKey, readWs, saveWs, withoutOffItems } from './Sidebar';
import { count as countLabel } from '../lib/format';

/** Phone bottom navigation (owner, 12 Nov 2026): the four main screens this person can open, then Menu, which opens
 *  every module grouped like the desktop sidebar. The four come from this preference order, keeping only screens the
 *  person's menu holds (their permission levels), so operations, finance and sales staff each get their own four.
 *  Money screens are not on the phone (owner, 11 Oct 2026), so none of Finance is a candidate. */
const TAB_PREF: { path: string; label?: string }[] = [
  { path: '/' }, { path: '/operations/today' }, { path: '/reservations/calendar' }, { path: '/reservations/bookings' },
  { path: '/operations/cleaning' }, { path: '/operations/maintenance' }, { path: '/properties/units', label: 'Units' },
  { path: '/owners' }, { path: '/performance/analytics' }, { path: '/communication/inbox' }, { path: '/my-claims' },
];

export const TAB_BAR_HEIGHT = 64;

type Tab = { key: string; label: string; icon: string; path: string; tabbed?: string[] };

/** The person's four tabs, from their menu (navFor). A screen inside a tabbed entry (All units) takes the entry's name
 *  and icon, and stays lit on the entry's other tabs. */
export function mainTabs(groups: NavGroup[]): Tab[] {
  const out: Tab[] = [];
  for (const pref of TAB_PREF) {
    if (out.length >= 4) break;
    for (const g of groups) for (const it of g.items) {
      if (out.some(t => t.path === pref.path)) continue;
      if (it.path === pref.path) out.push({ key: it.key, label: it.label, icon: toPascal(it.icon), path: it.path });
      const c = it.children?.find(ch => ch.path === pref.path);
      if (c && it.tabs) out.push({ key: c.key, label: pref.label ?? it.label, icon: toPascal(it.icon), path: c.path, tabbed: it.children!.map(ch => ch.path) });
    }
  }
  return out;
}

export default function MobileTabBar({ path, navigate }: { path: string; navigate: (p: string) => void }) {
  const { user } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = useMemo(() => (user ? mainTabs(navFor(user.role, false, user.access)) : []), [user]);
  const under = (p: string) => path === p || path.startsWith(p + '/');
  const onTab = (t: Tab) => t.path === '/' ? path === '/' : (t.tabbed ?? [t.path]).some(under);

  return (
    <>
      <nav aria-label="Main" data-print-hide style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
        height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
        paddingBottom: 'env(safe-area-inset-bottom)', boxShadow: '0 -6px 20px rgba(0,0,0,0.06)',
        display: 'grid', gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))`, alignItems: 'stretch', background: color.card, borderTop: `1px solid ${color.border}`,
      }}>
        {tabs.map(t => {
          const on = onTab(t);
          return (
            <button key={t.key} type="button" onClick={() => navigate(t.path)} aria-current={on ? 'page' : undefined}
              style={{
                minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                border: 'none', background: 'transparent', cursor: 'pointer', color: on ? color.ink : color.textMuted,
                fontSize: 11, fontWeight: 600, padding: '0 2px',
              }}>
              <Icon name={t.icon} size="base" color={on ? color.goldInk : 'currentColor'} />
              <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-label="Menu: all modules" aria-expanded={moreOpen}
          style={{
            minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
            border: 'none', background: 'transparent', cursor: 'pointer', color: moreOpen ? color.ink : color.textMuted, fontSize: 11, fontWeight: 600,
          }}>
          <Icon name="Menu" size="base" color={moreOpen ? color.goldInk : 'currentColor'} />
          <span>Menu</span>
        </button>
      </nav>
      {moreOpen && <MoreSheet path={path} onClose={() => setMoreOpen(false)} navigate={p => { setMoreOpen(false); navigate(p); }} />}
    </>
  );
}

/** Everyone has My account, so the Settings hub is always offered. */
const SETTINGS_ROW: NavItem = { key: 'settingsHub', label: 'Settings', icon: 'settings', path: '/settings' };

/** `keys`: the sub-tabs a tabbed entry's row stands for, so the row is lit on any of them. */
type MenuRow = { key: string; label: string; icon: string; path: string; count: number; keys?: string[] };
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
    .map(g => ({ ...g, items: g.items.filter(item => item.phone !== false) }))
    .filter(g => g.items.length > 0)
    // The Settings hub (/settings) holds the account and every system page on a phone (MobileSettingsHub); it is a row
    // here, since the tab bar has room only for the four main screens and Menu (owner, 12 Nov 2026).
    .map(g => g.workspace === 'rental' && g.label === 'SYSTEM' ? { ...g, label: 'SETTINGS AND SUPPORT', items: [SETTINGS_ROW, ...g.items.filter(it => it.key === 'itSupport')] } : g),
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
          if (it.tabs && it.children?.length) {
            // One row for an entry whose screens are sub-tabs (Units, Owners): it opens the first one shown on a phone.
            // Left off when none of its tabs is for the phone (Yearly and YGRR only, owner 11 Oct 2026: no money work there).
            const first = it.children.find(c => c.phone !== false);
            if (first && (hit(it.label) || it.children.some(c => hit(c.label)))) {
              loose.push({ key: it.key, label: it.label, icon: it.icon, path: first.path, keys: it.children.map(c => c.key),
                count: it.children.filter(c => c.phone !== false).reduce((sum, c) => sum + n(c.badge), 0) });
            }
          } else if (it.children?.length) {
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
          <span style={{ fontSize: 19, fontWeight: 600, color: color.ink }}>Menu</span>
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
                  const on = r.key === current || !!(current && r.keys?.includes(current));
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
