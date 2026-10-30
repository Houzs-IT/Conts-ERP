import { type CSSProperties, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { color, dcGlass, shell, radius, motion, text } from '../theme';
import { groupName, navFor, withoutOffItems, workspaceOf, WORKSPACE_LABEL, type BadgeKey, type NavGroup, type Workspace } from '../lib/navigation';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { useNavCounts } from '../lib/navBadges';
import { rememberPage, useItUnread } from '../lib/itSupport';
import { jobTitle } from '../lib/vocabulary';
import Icon, { toPascal } from './Icon';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { DARK_MODE_READY } from '../lib/theme';
import { cx } from '../lib/design-tokens';
import { count as countLabel } from '../lib/format';

interface Props { path: string; navigate: (p: string) => void; open: boolean; onToggle: () => void }

/** The chosen workspace survives a reload. Storage can throw (private mode), so every access is guarded. */
const WS_KEY = 'conts.shell.workspace';
export const readWs = (): Workspace => { try { return localStorage.getItem(WS_KEY) === 'supply' ? 'supply' : 'rental'; } catch { return 'rental'; } };
export const saveWs = (w: Workspace) => { try { localStorage.setItem(WS_KEY, w); } catch { /* not kept */ } };

/** Whether the dark theme is on. theme.ts writes data-theme on <html>, and the top bar's switch changes it at any time. */
const subscribeTheme = (onChange: () => void): (() => void) => {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};
export const useDarkTheme = (): boolean =>
  useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme === 'theconts-dark');

export type SidebarLookKey = 'conts' | 'dcLight' | 'dcDark';

/** Every colour the menu paints, per skin. */
export interface SidebarLook {
  /** The column behind the menu. */
  shellBg: string;
  /** The glass card the menu sits on (Dream Crafter only); null keeps the plain column. */
  card: CSSProperties | null;
  textOn: string; text: string; muted: string; faint: string;
  /** Hairlines under the logo and above the account button. */
  line: string;
  activeBg: string; activeShadow: string; childOnBg: string; childOnShadow: string;
  badgeBg: string; badgeOnBg: string; badgeInk: string; badgeOnInk: string;
  /** The rule beside open sub-items, and the group hairlines on the rail. */
  rule: string; divider: string;
  /** The faint fill of the rail's expand button and the open account button. */
  wash: string;
  track: string; tabOnBg: string; tabOnBorder: string; tabOnInk: string;
  /** Left unset where none is wanted, so theme-dark.css can still ring The Conts tab. */
  tabOnShadow?: string;
  railSwitchInk: string; dot: string; dotRing: string; avatarBg: string; avatarInk: string;
  /** The logo's light-on-dark artwork. */
  onDark: boolean;
  /** Icons on a tile, as in the glass designs; null draws them bare. */
  tile: { background: string; boxShadow: string } | null;
  itemH: number;
  /** The selected item's weight; undefined leaves it as the menu's own. */
  weightOn?: number;
}

const GLASS_SHAPE: CSSProperties = { backdropFilter: 'blur(30px) saturate(1.6)', WebkitBackdropFilter: 'blur(30px) saturate(1.6)' };

/** conts is the black sidebar as it always was. The Dream Crafter workspace takes the glass look of the Project
 *  Workspace designs: v10 "Vision" in the light theme, v13 "Night Glass" in the dark one (PLAN-dc-sidebar.md). */
export const LOOKS: Record<SidebarLookKey, SidebarLook> = {
  conts: {
    shellBg: color.black, card: null,
    textOn: 'var(--color-text-inverse)', text: color.onDark, muted: color.dim, faint: color.faint, line: color.charcoal,
    activeBg: color.charcoal, activeShadow: `inset 2px 0 0 ${color.gold}`,
    // The same gold bar as a top-level item: the tint alone was too faint to find.
    childOnBg: 'rgba(200,164,106,0.14)', childOnShadow: `inset 2px 0 0 ${color.gold}`,
    // Badge text uses the menu's own text colours: gold and dim on these washes fell under 4.5:1.
    badgeBg: 'rgba(255,255,255,0.08)', badgeOnBg: 'rgba(200,164,106,0.18)', badgeInk: color.onDark, badgeOnInk: 'var(--color-text-inverse)',
    rule: 'rgba(255,255,255,0.12)', divider: 'rgba(255,255,255,0.1)', wash: 'rgba(255,255,255,0.06)',
    track: color.charcoal, tabOnBg: color.black, tabOnBorder: color.gold, tabOnInk: 'var(--color-text-inverse)',
    railSwitchInk: color.gold, dot: color.gold, dotRing: color.black, avatarBg: color.charcoal, avatarInk: color.gold,
    onDark: true, tile: null, itemH: shell.navItem,
  },
  dcLight: {
    shellBg: dcGlass.light.backdrop,
    card: {
      ...GLASS_SHAPE,
      background: 'linear-gradient(180deg,rgba(255,255,255,.86),rgba(244,246,251,.62))',
      border: '1px solid rgba(255,255,255,.8)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,1),inset 0 0 0 1px rgba(255,255,255,.35),inset 0 -10px 24px rgba(120,150,255,.08),'
        + '0 0 0 1px rgba(120,150,255,.14),0 0 40px -12px rgba(110,160,255,.45),0 30px 60px -24px rgba(60,80,160,.35)',
    },
    textOn: dcGlass.light.ink, text: dcGlass.light.text, muted: dcGlass.light.muted, faint: dcGlass.light.faint, line: 'rgba(17,18,22,.08)',
    activeBg: dcGlass.light.surface, activeShadow: '0 0 0 1px rgba(255,255,255,.7),0 6px 14px -8px rgba(60,80,160,.35)',
    childOnBg: 'rgba(255,255,255,.75)', childOnShadow: '0 0 0 1px rgba(255,255,255,.7)',
    badgeBg: 'rgba(17,18,22,.06)', badgeOnBg: 'rgba(17,18,22,.08)', badgeInk: dcGlass.light.ink, badgeOnInk: dcGlass.light.ink,
    rule: 'rgba(17,18,22,.12)', divider: 'rgba(17,18,22,.08)', wash: 'rgba(17,18,22,.05)',
    track: 'rgba(17,18,22,.06)', tabOnBg: dcGlass.light.surface, tabOnBorder: 'rgba(255,255,255,.9)', tabOnInk: dcGlass.light.ink, tabOnShadow: '0 4px 10px -6px rgba(60,80,160,.35)',
    railSwitchInk: dcGlass.light.ink, dot: dcGlass.light.accent, dotRing: dcGlass.light.surface, avatarBg: dcGlass.light.ink, avatarInk: dcGlass.light.surface,
    onDark: false, tile: { background: 'rgba(255,255,255,.8)', boxShadow: '0 3px 6px -2px rgba(90,105,150,.22)' }, itemH: 38, weightOn: 600,
  },
  dcDark: {
    shellBg: dcGlass.dark.backdrop,
    card: {
      ...GLASS_SHAPE,
      background: 'linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.025))',
      border: '1px solid rgba(150,175,255,.24)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.18),inset 0 0 0 1px rgba(255,255,255,.04),inset 0 -10px 24px rgba(120,150,255,.08),'
        + '0 0 0 1px rgba(120,150,255,.14),0 0 40px -10px rgba(80,130,255,.35),0 30px 60px -24px rgba(0,0,0,.6)',
    },
    textOn: dcGlass.dark.ink, text: dcGlass.dark.text, muted: dcGlass.dark.muted, faint: dcGlass.dark.faint, line: 'rgba(150,175,255,.14)',
    activeBg: 'rgba(255,255,255,.08)', activeShadow: '0 0 0 1px rgba(150,175,255,.18)',
    childOnBg: 'rgba(255,255,255,.06)', childOnShadow: '0 0 0 1px rgba(150,175,255,.14)',
    badgeBg: 'rgba(150,175,255,.16)', badgeOnBg: 'rgba(150,175,255,.24)', badgeInk: dcGlass.dark.ink, badgeOnInk: dcGlass.dark.ink,
    rule: 'rgba(150,175,255,.18)', divider: 'rgba(150,175,255,.14)', wash: 'rgba(255,255,255,.06)',
    track: 'rgba(255,255,255,.05)', tabOnBg: 'rgba(255,255,255,.1)', tabOnBorder: 'rgba(150,175,255,.3)', tabOnInk: dcGlass.dark.ink,
    railSwitchInk: dcGlass.dark.accent, dot: dcGlass.dark.accent, dotRing: dcGlass.dark.base, avatarBg: 'rgba(120,160,255,.28)', avatarInk: dcGlass.dark.surface,
    onDark: true, tile: { background: 'rgba(255,255,255,.06)', boxShadow: 'inset 0 0 0 1px rgba(150,175,255,.12)' }, itemH: 38, weightOn: 600,
  },
};

/** Which skin the menu wears: the glass one only on the Dream Crafter side. */
export const sidebarLookKey = (dreamCrafter: boolean, dark: boolean): SidebarLookKey =>
  dreamCrafter ? (dark ? 'dcDark' : 'dcLight') : 'conts';

function parentOf(groups: NavGroup[], path: string) {
  for (const g of groups) for (const it of g.items)
    if (it.children?.some(c => c.path === path)) return it.key;
  return null;
}

/** The item a path belongs to: exact match, or the deepest menu path it sits under (records, sub-pages).
 *  Children count too, so the phone menu (one row per screen) can use it. */
export function activeKey(groups: NavGroup[], path: string) {
  let best: { key: string; len: number } | null = null;
  for (const g of groups) for (const it of [...g.items, ...g.items.flatMap(i => i.children ?? [])]) {
    if (!it.path) continue;
    if (it.path === path) return it.key;
    if (it.path !== '/' && path.startsWith(it.path + '/') && (!best || it.path.length > best.len)) best = { key: it.key, len: it.path.length };
  }
  return best?.key ?? null;
}

/** Shared with the phone menu so both menus hide the same things (navigation.ts). */
export { withoutOffItems };

export default function Sidebar({ path, navigate, open, onToggle }: Props) {
  const { user, logout } = useSession();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const engine = useApi<{ enabled: boolean }>('/supply-chain/engine');
  const counts = useNavCounts(path);
  const approvalsOn = counts?.approvalsOn === true;
  const all = useMemo(() => withoutOffItems(navFor(user!.role, !!engine.data?.enabled, user!.access), approvalsOn),
    [user, engine.data?.enabled, approvalsOn]);

  // The account menu closes the usual ways: Escape, a click anywhere else, or moving to another page.
  useEffect(() => setProfileOpen(false), [path]);
  useEffect(() => {
    if (!profileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setProfileOpen(false); };
    const onDown = (e: PointerEvent) => { if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [profileOpen]);
  const hasSupply = all.some(g => g.workspace === 'supply');

  // Opening a supply chain address (a link, the back button) shows its workspace; otherwise the last choice stands.
  const [ws, setWs] = useState<Workspace>(() => workspaceOf(path) ?? readWs());
  useEffect(() => { const w = workspaceOf(path); if (w) { setWs(w); saveWs(w); } }, [path]);
  useEffect(() => rememberPage(path), [path]);
  const pick = (w: Workspace) => {
    saveWs(w);
    const first = all.find(g => g.workspace === w)?.items[0];
    const target = first?.path ?? first?.children?.[0]?.path;
    const swap = () => {
      flushSync(() => setWs(w));
      if (target && workspaceOf(path) !== w) navigate(target);
    };
    // The two sides wear different skins, so the swap is one snapshot crossfade, as the theme switch does (lib/theme.ts).
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (w !== ws && document.startViewTransition && !reduce) document.startViewTransition(swap);
    else swap();
  };
  const groups = all.filter(g => g.workspace === (hasSupply ? ws : 'rental'));
  // The supply chain workspace is Dream Crafter's side of the business, so its logo heads the menu there.
  const brand = hasSupply && ws === 'supply' ? 'dreamCrafter' : 'theConts';
  const dark = useDarkTheme();
  const lookKey = sidebarLookKey(brand === 'dreamCrafter', dark);
  const look = LOOKS[lookKey];
  const glass = look.card !== null;
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
  /** What a count means, for the tooltip and screen readers ("2 awaiting owner approval"). */
  const countWords = (k: BadgeKey | undefined, n: number): string => {
    if (!n) return '';
    if (k === 'maintenance') {
      const waiting = Math.min(n, counts?.maintenanceAwaiting ?? 0), openJobs = n - waiting;
      return [openJobs ? `${openJobs} open` : '', waiting ? `${waiting} awaiting owner approval` : ''].filter(Boolean).join(', ');
    }
    if (k === 'inbox') return `${n} unread`;
    if (k === 'today') return `${n} check-ins and checkouts`;
    if (k === 'cleaning') return `${n} to clean`;
    if (k === 'statements') return `${n} final, not sent`;
    if (k === 'approvals') return `${n} waiting for approval`;
    if (k === 'showcase') return `${n} ${n === 1 ? 'figure' : 'figures'} overridden`;
    return `${n} new`;
  };

  const badge = (on: boolean): CSSProperties => ({
    fontSize: text.micro, fontWeight: 600, padding: '1px 6px', borderRadius: radius.pill, flex: 'none', fontVariantNumeric: 'tabular-nums',
    background: on ? look.badgeOnBg : look.badgeBg,
    color: on ? look.badgeOnInk : look.badgeInk,
  });

  return (
    <div data-print-hide data-sidebar data-look={lookKey} style={{
      width: open ? shell.sidebar : shell.sidebarCollapsed, flex: 'none', height: '100dvh', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', background: look.shellBg, color: look.textOn,
      // The glass card floats inside the column, so the backdrop shows round it.
      padding: glass ? (open ? 12 : 8) : 0,
      transition: `width ${motion.standard} ${motion.ease}`,
    }}>
      {/* The glass card on the Dream Crafter side; a plain column on The Conts side. It stacks above the page so the
          account menu, which can reach past the rail, is not drawn under the content. */}
      <div className={glass ? 'sidebar-glass' : undefined} style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        ...(look.card && { ...look.card, borderRadius: open ? 28 : 20, padding: open ? '6px 0 4px' : '4px 0', position: 'relative', zIndex: 1 }),
      }}>
      {/* Expanded: logo then the collapse control on the right. Collapsed: the mark, and the expand control
          centred under it, both inside the 68px rail (it used to sit outside the rail and be clipped). */}
      <div style={{
        padding: open ? (glass ? '14px 10px 6px 14px' : '18px 12px 18px 16px') : '14px 0 10px', display: 'flex', flexDirection: open ? 'row' : 'column',
        alignItems: 'center', gap: open ? 8 : 10, borderBottom: glass ? 'none' : `1px solid ${look.line}`,
      }}>
        <div style={{ flex: open ? 1 : 'none', minWidth: 0, overflow: 'hidden' }}>
          {open ? <Logo variant="full" size="sm" onDark={look.onDark} product brand={brand} /> : <Logo variant="mark" size="sm" onDark={look.onDark} brand={brand} />}
        </div>
        <button onClick={onToggle} aria-label={open ? 'Collapse navigation' : 'Expand navigation'} title={open ? 'Collapse navigation' : 'Expand navigation'}
          style={{ width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.sm, color: look.text, background: open ? 'none' : look.wash, border: 'none', cursor: 'pointer' }}>
          <Icon name={open ? 'PanelLeftClose' : 'PanelLeftOpen'} size="sm" />
        </button>
      </div>

      {hasSupply && (
        open ? (
          <div role="tablist" aria-label="Workspace" style={{ margin: '12px 10px 0', padding: 3, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, borderRadius: radius.control, background: look.track }}>
            {(['rental', 'supply'] as Workspace[]).map(w => (
              <button key={w} role="tab" aria-selected={ws === w} onClick={() => pick(w)}
                // A real border, not a shadow, so high-contrast mode still shows which side is chosen.
                style={{ height: 28, borderRadius: 6, border: `1px solid ${ws === w ? look.tabOnBorder : 'transparent'}`, cursor: 'pointer', font: 'inherit', fontSize: text.meta, fontWeight: 500,
                  background: ws === w ? look.tabOnBg : 'transparent', color: ws === w ? look.tabOnInk : look.text, boxShadow: ws === w ? look.tabOnShadow : undefined }}>
                {WORKSPACE_LABEL[w]}
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => pick(ws === 'rental' ? 'supply' : 'rental')} title={`Switch to ${WORKSPACE_LABEL[ws === 'rental' ? 'supply' : 'rental']}`}
            aria-label={`Workspace: ${WORKSPACE_LABEL[ws]}. Switch to ${WORKSPACE_LABEL[ws === 'rental' ? 'supply' : 'rental']}`}
            style={{ margin: '10px auto 0', width: 40, height: 28, display: 'grid', placeItems: 'center', borderRadius: radius.sm, border: 'none', cursor: 'pointer', background: look.track, color: look.railSwitchInk }}>
            <Icon name={ws === 'rental' ? 'House' : 'Boxes'} size="sm" />
          </button>
        )
      )}

      {/* Own scroller: the sidebar never rides the page scroll. Its bar is thin and dark and shows only while the
          menu is scrolling (.nav-scroll in tokens.css), never the grey browser bar with arrows. */}
      <nav aria-label={hasSupply ? WORKSPACE_LABEL[ws] : 'Main'} className={cx('nav-scroll', scrolling && 'is-scrolling')} onScroll={onNavScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: open ? '12px 10px 20px' : `10px ${glass ? 6 : 10}px 20px`, display: 'flex', flexDirection: 'column', gap: open ? 14 : 6 }}>
        {groups.map((g, gi) => {
          const sectionKey = `${g.workspace}:${g.label}`; // SYSTEM is a group of both workspaces
          const sectionCollapsed = open && !!collapsedSections[sectionKey];
          return (
          <div key={sectionKey} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {open ? (
              <button type="button"
                onClick={() => setCollapsedSections(s => ({ ...s, [sectionKey]: !s[sectionKey] }))}
                aria-expanded={!sectionCollapsed}
                aria-label={`${groupName(g.label)} section`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 8px 4px',
                  background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left',
                  fontSize: text.micro, fontWeight: 600, letterSpacing: '0.13em', color: look.muted,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{g.label}</span>
                <span style={{ display: 'flex', opacity: 0.7, transition: `transform 180ms ${motion.ease}`, transform: `rotate(${sectionCollapsed ? -90 : 0}deg)` }}>
                  <Icon name="ChevronDown" size="sm" />
                </span>
              </button>
            ) : gi > 0 && (
              // The rail keeps the group boundaries as hairlines.
              <div aria-hidden style={{ height: 1, margin: '4px 8px 6px', background: look.divider }} />
            )}
            {!sectionCollapsed && g.items.map(it => {
              const isOpen = open && (expanded[it.key] ?? activeParent === it.key);
              const selfActive = it.key === selected || (!!it.children && activeParent === it.key && !isOpen);
              const n = countOf(it.badge) || (it.children ?? []).reduce((s, c) => s + countOf(c.badge), 0);
              return (
                <div key={it.key} style={{ display: 'flex', flexDirection: 'column' }}>
                  <button type="button"
                    title={n > 0 ? `${it.label}: ${countWords(it.badge ?? it.children?.find(c => countOf(c.badge))?.badge, n)}` : it.label}
                    aria-label={n > 0 ? `${it.label}, ${countWords(it.badge ?? it.children?.find(c => countOf(c.badge))?.badge, n)}` : it.label}
                    aria-current={selfActive && !it.children ? 'page' : undefined}
                    aria-expanded={open && it.children ? isOpen : undefined}
                    onClick={() => {
                      if (it.children) {
                        if (!open) { navigate(it.children[0].path); return; }
                        const willOpen = !(expanded[it.key] ?? activeParent === it.key);
                        setExpanded(e => ({ ...e, [it.key]: willOpen }));
                        if (willOpen && activeParent !== it.key) navigate(it.children[0].path);
                      } else if (it.path) navigate(it.path);
                    }}
                    style={{
                      position: 'relative', display: 'flex', alignItems: 'center', gap: 10, height: look.itemH,
                      padding: open ? (look.tile ? '0 6px' : '0 9px') : 0, justifyContent: open ? 'flex-start' : 'center',
                      borderRadius: look.tile ? 10 : radius.control, cursor: 'pointer', border: 'none', width: '100%',
                      font: 'inherit', textAlign: 'left',
                      transition: `background ${motion.fast} ease-out`,
                      color: selfActive ? look.textOn : look.text,
                      background: selfActive ? look.activeBg : 'transparent',
                      boxShadow: selfActive ? look.activeShadow : 'none',
                      fontWeight: selfActive ? look.weightOn : undefined,
                    }}
                  >
                    {look.tile
                      ? <span aria-hidden style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center', ...look.tile }}><Icon name={toPascal(it.icon)} size="sm" /></span>
                      : <Icon name={toPascal(it.icon)} size="nav" />}
                    {open && <span style={{ flex: 1, minWidth: 0, fontSize: text.copy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>}
                    {open && it.fresh && n === 0 && <span style={{ fontSize: text.micro, fontWeight: 700, padding: '1px 6px', borderRadius: radius.pill, flex: 'none', background: color.gold, color: color.black }}>New</span>}
                    {open && !it.children && n > 0 && <span style={badge(selfActive)}>{countLabel(n)}</span>}
                    {/* The rail shows a dot where the full menu shows a count. */}
                    {!open && n > 0 && <span aria-hidden style={{ position: 'absolute', top: look.tile ? 4 : 6, right: look.tile ? 6 : 10, width: 7, height: 7, borderRadius: 999, background: look.dot, boxShadow: `0 0 0 2px ${look.dotRing}` }} />}
                    {open && it.children && (
                      <span style={{ display: 'flex', opacity: 0.6, transition: `transform 180ms ${motion.ease}`, transform: `rotate(${isOpen ? 90 : 0}deg)` }}>
                        <Icon name="ChevronRight" size="sm" />
                      </span>
                    )}
                  </button>

                  {isOpen && it.children && (
                    <div style={{ margin: `2px 0 4px ${look.tile ? 22 : 20}px`, paddingLeft: 12, borderLeft: `1px solid ${look.rule}`, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {it.children.map(c => {
                        const on = c.path === path;
                        return (
                          <button key={c.key} type="button" onClick={() => navigate(c.path)} aria-current={on ? 'page' : undefined}
                            aria-label={countOf(c.badge) > 0 ? `${c.label}, ${countWords(c.badge, countOf(c.badge))}` : c.label}
                            title={countOf(c.badge) > 0 ? `${c.label}: ${countWords(c.badge, countOf(c.badge))}` : undefined}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, height: shell.navItemL3,
                              padding: '0 9px', borderRadius: 7, cursor: 'pointer', border: 'none', width: '100%',
                              font: 'inherit', textAlign: 'left',
                              color: on ? look.textOn : look.faint,
                              background: on ? look.childOnBg : 'transparent',
                              boxShadow: on ? look.childOnShadow : 'none',
                              fontWeight: on ? 500 : 400,
                            }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: text.meta, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                            {countOf(c.badge) > 0 && <span style={badge(on)}>{countLabel(countOf(c.badge))}</span>}
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

      <div ref={profileRef} style={{ flex: 'none', padding: 10, borderTop: `1px solid ${look.line}`, position: 'relative' }}>
        {profileOpen && (
          // .menu-sheet: the light-card hover and press washes in styles/hover.css.
          <div className="menu-sheet" style={{ position: 'absolute', left: 10, bottom: 62, width: Math.max(224, open ? shell.sidebar - 20 : 224), zIndex: 30, background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: '0 12px 32px rgba(21,21,21,0.24)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: text.copy, fontWeight: 600, color: color.ink }}>{user!.fullName}</span>
              <span style={{ fontSize: text.small, color: color.textMuted }}>{user!.email}</span>
            </div>
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${color.borderMuted}` }}>
              {DARK_MODE_READY && <ThemeToggle />}
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
        <button type="button" onClick={() => setProfileOpen(v => !v)} aria-label={`${user!.fullName}, account menu`} aria-expanded={profileOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: radius.control, cursor: 'pointer', width: '100%', border: 'none', font: 'inherit', textAlign: 'left', justifyContent: open ? 'flex-start' : 'center', background: profileOpen ? look.wash : 'transparent', color: look.textOn }}>
          <span style={{ width: 30, height: 30, flex: 'none', borderRadius: radius.pill, background: look.avatarBg, color: look.avatarInk, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
            {user!.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </span>
          {open && (
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: text.copy, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user!.fullName}</span>
              <span style={{ fontSize: text.micro, color: look.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{jobTitle(user!)}</span>
            </span>
          )}
          {open && <Icon name="ChevronUp" size="sm" color={look.muted} />}
        </button>
      </div>
      </div>
    </div>
  );
}
