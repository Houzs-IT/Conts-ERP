import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { color, shell, radius, motion, text } from '../theme';
import { navFor, workspaceOf, WORKSPACE_LABEL, type BadgeKey, type NavGroup, type Workspace } from '../lib/navigation';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { useNavCounts } from '../lib/navBadges';
import { useItUnread } from '../lib/itSupport';
import { ROLE_LABEL } from '../lib/vocabulary';
import Icon, { toPascal } from './Icon';
import { Logo } from './Logo';
import { cx } from '../lib/design-tokens';
import { count as countLabel } from '../lib/format';

/** `phone`: the phone drawer, which leaves out the groups marked phone: false (navigation.ts). */
interface Props { path: string; navigate: (p: string) => void; open: boolean; onToggle: () => void; phone?: boolean }

/** The chosen workspace survives a reload. Storage can throw (private mode), so every access is guarded. */
const WS_KEY = 'conts.shell.workspace';
const readWs = (): Workspace => { try { return localStorage.getItem(WS_KEY) === 'supply' ? 'supply' : 'rental'; } catch { return 'rental'; } };
const saveWs = (w: Workspace) => { try { localStorage.setItem(WS_KEY, w); } catch { /* not kept */ } };

function parentOf(groups: NavGroup[], path: string) {
  for (const g of groups) for (const it of g.items)
    if (it.children?.some(c => c.path === path)) return it.key;
  return null;
}

/** The item a path belongs to: exact match, or the deepest menu path it sits under (records, sub-pages). */
function activeKey(groups: NavGroup[], path: string) {
  let best: { key: string; len: number } | null = null;
  for (const g of groups) for (const it of g.items) {
    if (!it.path) continue;
    if (it.path === path) return it.key;
    if (it.path !== '/' && path.startsWith(it.path + '/') && (!best || it.path.length > best.len)) best = { key: it.key, len: it.path.length };
  }
  return best?.key ?? null;
}

export default function Sidebar({ path, navigate, open, onToggle, phone = false }: Props) {
  const { user, logout } = useSession();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const engine = useApi<{ enabled: boolean }>('/supply-chain/engine');
  const counts = useNavCounts(path);
  // Approvals are off unless Settings turns them on (owner, 11 Oct 2026); the page stays reachable by its address.
  const approvalsOn = counts?.approvalsOn === true;
  const all = useMemo(() => navFor(user!.role, !!engine.data?.enabled, user!.access)
    .filter(g => !phone || g.phone !== false)
    .map(g => ({ ...g, items: g.items.filter(it => it.key !== 'approvals' || approvalsOn) })), [user, engine.data?.enabled, approvalsOn, phone]);
  const hasSupply = all.some(g => g.workspace === 'supply');

  // Opening a supply chain address (a link, the back button) shows its workspace; otherwise the last choice stands.
  const [ws, setWs] = useState<Workspace>(() => workspaceOf(path) ?? readWs());
  useEffect(() => { const w = workspaceOf(path); if (w) { setWs(w); saveWs(w); } }, [path]);
  const pick = (w: Workspace) => {
    setWs(w); saveWs(w);
    const first = all.find(g => g.workspace === w)?.items[0];
    const target = first?.path ?? first?.children?.[0]?.path;
    if (target && workspaceOf(path) !== w) navigate(target);
  };
  const groups = all.filter(g => g.workspace === (hasSupply ? ws : 'rental'));
  const activeParent = parentOf(groups, path);
  const selected = activeKey(groups, path);

  // The scrollbar shows while the menu moves and fades a second after it stops.
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<number | undefined>(undefined);
  const onNavScroll = () => {
    setScrolling(true);
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => setScrolling(false), 900);
  };
  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);

  const itUnread = useItUnread();
  const countOf = (k?: BadgeKey) => (k === 'itSupport' ? itUnread : (k && counts?.[k]) || 0);

  const badge = (on: boolean): CSSProperties => ({
    fontSize: text.micro, fontWeight: 600, padding: '1px 6px', borderRadius: radius.pill, flex: 'none',
    background: on ? 'rgba(200,164,106,0.18)' : 'rgba(255,255,255,0.08)',
    color: on ? color.gold : color.dim,
  });

  return (
    <div data-print-hide style={{
      width: open ? shell.sidebar : shell.sidebarCollapsed, flex: 'none', height: '100dvh',
      display: 'flex', flexDirection: 'column', background: color.black, color: 'var(--color-text-inverse)',
      transition: `width ${motion.standard} ${motion.ease}`,
    }}>
      {/* Expanded: logo then the collapse control on the right. Collapsed: the mark, and the expand control
          centred under it, both inside the 68px rail (it used to sit outside the rail and be clipped). */}
      <div style={{
        padding: open ? '18px 12px 18px 16px' : '14px 0 10px', display: 'flex', flexDirection: open ? 'row' : 'column',
        alignItems: 'center', gap: open ? 8 : 10, borderBottom: `1px solid ${color.charcoal}`,
      }}>
        <div style={{ flex: open ? 1 : 'none', minWidth: 0, overflow: 'hidden' }}>
          {open ? <Logo variant="full" size="sm" onDark product /> : <Logo variant="mark" size="sm" onDark />}
        </div>
        <button onClick={onToggle} aria-label={open ? 'Collapse navigation' : 'Expand navigation'} title={open ? 'Collapse navigation' : 'Expand navigation'}
          style={{ width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.sm, color: color.onDark, background: open ? 'none' : 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer' }}>
          <Icon name={open ? 'PanelLeftClose' : 'PanelLeftOpen'} size="sm" />
        </button>
      </div>

      {hasSupply && (
        open ? (
          <div role="tablist" aria-label="Workspace" style={{ margin: '12px 10px 0', padding: 3, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, borderRadius: radius.control, background: color.charcoal }}>
            {(['rental', 'supply'] as Workspace[]).map(w => (
              <button key={w} role="tab" aria-selected={ws === w} onClick={() => pick(w)}
                style={{ height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', font: 'inherit', fontSize: text.meta, fontWeight: 500,
                  background: ws === w ? color.black : 'transparent', color: ws === w ? 'var(--color-text-inverse)' : color.dim,
                  boxShadow: ws === w ? `inset 0 0 0 1px rgba(200,164,106,0.35)` : 'none' }}>
                {WORKSPACE_LABEL[w]}
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => pick(ws === 'rental' ? 'supply' : 'rental')} title={`Switch to ${WORKSPACE_LABEL[ws === 'rental' ? 'supply' : 'rental']}`}
            aria-label={`Workspace: ${WORKSPACE_LABEL[ws]}. Switch to ${WORKSPACE_LABEL[ws === 'rental' ? 'supply' : 'rental']}`}
            style={{ margin: '10px auto 0', width: 40, height: 28, display: 'grid', placeItems: 'center', borderRadius: radius.sm, border: 'none', cursor: 'pointer', background: color.charcoal, color: color.gold }}>
            <Icon name={ws === 'rental' ? 'House' : 'Boxes'} size="sm" />
          </button>
        )
      )}

      {/* Own scroller: the sidebar never rides the page scroll. Its bar is thin and dark and shows only while the
          menu is scrolling (.nav-scroll in tokens.css), never the grey browser bar with arrows. */}
      <nav aria-label={hasSupply ? WORKSPACE_LABEL[ws] : 'Main'} className={cx('nav-scroll', scrolling && 'is-scrolling')} onScroll={onNavScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: open ? '12px 10px 20px' : '10px 10px 20px', display: 'flex', flexDirection: 'column', gap: open ? 14 : 6 }}>
        {groups.map((g, gi) => {
          const sectionCollapsed = open && !!collapsedSections[g.label];
          return (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {open ? (
              <button
                onClick={() => setCollapsedSections(s => ({ ...s, [g.label]: !s[g.label] }))}
                aria-expanded={!sectionCollapsed}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 8px 4px',
                  background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left',
                  fontSize: text.micro, fontWeight: 600, letterSpacing: '0.13em', color: color.dim,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{g.label}</span>
                <span style={{ display: 'flex', opacity: 0.7, transition: `transform 180ms ${motion.ease}`, transform: `rotate(${sectionCollapsed ? -90 : 0}deg)` }}>
                  <Icon name="ChevronDown" size="sm" />
                </span>
              </button>
            ) : gi > 0 && (
              // The rail keeps the group boundaries as hairlines.
              <div aria-hidden style={{ height: 1, margin: '4px 8px 6px', background: 'rgba(255,255,255,0.1)' }} />
            )}
            {!sectionCollapsed && g.items.map(it => {
              const isOpen = open && (expanded[it.key] ?? activeParent === it.key);
              const selfActive = it.key === selected || (!!it.children && activeParent === it.key && !isOpen);
              const n = countOf(it.badge) || (it.children ?? []).reduce((s, c) => s + countOf(c.badge), 0);
              return (
                <div key={it.key} style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    title={open ? undefined : (n > 0 ? `${it.label} (${n})` : it.label)}
                    aria-label={open ? undefined : it.label}
                    aria-current={selfActive && !it.children ? 'page' : undefined}
                    onClick={() => {
                      if (it.children) {
                        if (!open) { navigate(it.children[0].path); return; }
                        const willOpen = !(expanded[it.key] ?? activeParent === it.key);
                        setExpanded(e => ({ ...e, [it.key]: willOpen }));
                        if (willOpen && activeParent !== it.key) navigate(it.children[0].path);
                      } else if (it.path) navigate(it.path);
                    }}
                    style={{
                      position: 'relative', display: 'flex', alignItems: 'center', gap: 10, height: shell.navItem,
                      padding: open ? '0 9px' : 0, justifyContent: open ? 'flex-start' : 'center',
                      borderRadius: radius.control, cursor: 'pointer', border: 'none', width: '100%',
                      font: 'inherit', textAlign: 'left',
                      transition: `background ${motion.fast} ease-out`,
                      color: selfActive ? 'var(--color-text-inverse)' : color.onDark,
                      background: selfActive ? color.charcoal : 'transparent',
                      boxShadow: selfActive ? `inset 2px 0 0 ${color.gold}` : 'none',
                    }}
                  >
                    <Icon name={toPascal(it.icon)} size="nav" />
                    {open && <span style={{ flex: 1, minWidth: 0, fontSize: text.copy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>}
                    {open && !it.children && n > 0 && <span style={badge(selfActive)}>{countLabel(n)}</span>}
                    {/* The rail shows a dot where the full menu shows a count. */}
                    {!open && n > 0 && <span aria-hidden style={{ position: 'absolute', top: 6, right: 10, width: 7, height: 7, borderRadius: 999, background: color.gold, boxShadow: `0 0 0 2px ${color.black}` }} />}
                    {open && it.children && (
                      <span style={{ display: 'flex', opacity: 0.6, transition: `transform 180ms ${motion.ease}`, transform: `rotate(${isOpen ? 90 : 0}deg)` }}>
                        <Icon name="ChevronRight" size="sm" />
                      </span>
                    )}
                  </button>

                  {isOpen && it.children && (
                    <div style={{ margin: '2px 0 4px 20px', paddingLeft: 12, borderLeft: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {it.children.map(c => {
                        const on = c.path === path;
                        return (
                          <button key={c.key} onClick={() => navigate(c.path)} aria-current={on ? 'page' : undefined}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, height: shell.navItemL3,
                              padding: '0 9px', borderRadius: 7, cursor: 'pointer', border: 'none', width: '100%',
                              font: 'inherit', textAlign: 'left',
                              color: on ? 'var(--color-text-inverse)' : color.faint,
                              background: on ? 'rgba(200,164,106,0.14)' : 'transparent',
                              fontWeight: on ? 500 : 400,
                            }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: text.meta, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                            {countOf(c.badge) > 0 && <span style={badge(on)}>{countOf(c.badge)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          );
        })}
      </nav>

      <div style={{ flex: 'none', padding: 10, borderTop: `1px solid ${color.charcoal}`, position: 'relative' }}>
        {profileOpen && (
          <div style={{ position: 'absolute', left: 10, bottom: 62, width: Math.max(224, open ? shell.sidebar - 20 : 224), zIndex: 30, background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: '0 12px 32px rgba(21,21,21,0.24)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: text.copy, fontWeight: 600, color: color.ink }}>{user!.fullName}</span>
              <span style={{ fontSize: text.small, color: color.textMuted }}>{user!.email}</span>
            </div>
            {[
              // BUTTONS §2: Notification settings have no screen yet, so they are not offered. My account holds the
              // person's own password, two-step sign-in, recent sign-ins and other devices.
              { label: 'My account', icon: 'ShieldCheck', go: () => { setProfileOpen(false); navigate('/account'); } },
              { label: 'Log out', icon: 'LogOut', danger: true, go: logout },
            ].map(m => (
              <button key={m.label} onClick={m.go}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', width: '100%', border: 'none', borderBottom: `1px solid ${color.borderMuted}`, background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: m.danger ? 'var(--color-critical-fg)' : color.ink }}>
                <Icon name={m.icon} size="sm" />
                <span style={{ fontSize: text.copy }}>{m.label}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setProfileOpen(v => !v)} aria-label={open ? undefined : `${user!.fullName}, account menu`}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: radius.control, cursor: 'pointer', width: '100%', border: 'none', font: 'inherit', textAlign: 'left', justifyContent: open ? 'flex-start' : 'center', background: profileOpen ? 'rgba(255,255,255,0.06)' : 'transparent', color: 'var(--color-text-inverse)' }}>
          <span style={{ width: 30, height: 30, flex: 'none', borderRadius: radius.pill, background: color.charcoal, color: color.gold, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
            {user!.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </span>
          {open && (
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: text.copy, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.fullName}</span>
              <span style={{ fontSize: text.micro, color: color.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ROLE_LABEL[user!.role] ?? user!.role}</span>
            </span>
          )}
          {open && <Icon name="ChevronUp" size="sm" color={color.dim} />}
        </button>
      </div>
    </div>
  );
}
