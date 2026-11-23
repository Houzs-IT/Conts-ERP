import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LOOKS, readWs, sidebarLookKey, useDarkTheme } from './Sidebar';
import { color, radius, text, shell, motion } from '../theme';
import { findNav, workspaceOf } from '../lib/navigation';
import { useNavCounts } from '../lib/navBadges';
import { relative } from '../lib/format';
import Icon from './Icon';
import NotificationBell from './NotificationBell';
import { ThemeButton } from './ThemeToggle';
import { DemoButton } from './DemoMode';
import { Link } from 'react-router-dom';

// Staging only (it renders nothing elsewhere), so it stays out of the entry script.
const ViewAs = lazy(() => import('./ViewAs'));
// The search box loads when it is first opened.
const GlobalSearch = lazy(() => import('./GlobalSearch'));

/* ------------------------------------------------------------------ *
 * Application shell top bar (BUTTONS.md §2).
 *  - Breadcrumbs: group / menu entry / page.
 *  - Global search: `/`, Ctrl+K or Cmd+K opens it (GlobalSearch.tsx, loaded on first open); GET /api/search?q= finds
 *    rental and supply chain records of every kind the person may open, grouped by kind.
 *  - Light / dark switch (ThemeButton), then the bell (NotificationBell): the person's unread notices with a count,
 *    plus the live alerts from /api/nav/badges.
 * ------------------------------------------------------------------ */

export default function TopBar({
  path, navigate, action, compact = false,
}: { path: string; navigate?: (p: string) => void; action?: { label: string; onClick: () => void };
  /** Phone: only the controls, as 40px squares, for the shell's mobile header row. */
  compact?: boolean }) {
  const nav = findNav(path);
  // The browser tab names the page, so tabs, history and screen readers can tell pages apart.
  const pageName = nav ? (nav.page ?? nav.label) : path === '/account' ? 'My account' : path === '/notifications' ? 'Notifications' : null;
  // A supply chain screen is Dream Crafter's side; a page on neither side (My account) follows the sidebar's last company switch.
  const company = (workspaceOf(path) ?? readWs()) === 'supply' ? 'Dream Crafter' : 'The Conts';
  useEffect(() => { document.title = pageName ? `${pageName} · ${company}` : 'The Conts Property OS'; }, [pageName, company]);
  const ctl = compact ? 40 : shell.controlSm;
  const go = (p: string) => navigate?.(p);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  /* --------------------------- search --------------------------- */
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (searchOpen) return;
      // Ctrl+K / Cmd+K from anywhere, a text field included; `/` only when not typing.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); return; }
      if (e.key !== '/') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  /* ------------------------ notifications ------------------------ */
  const counts = useNavCounts(path);
  const channelSync = counts?.channels;
  // lastSentAt is the last ARI call Channex accepted (functions/api/nav/badges.ts). Calls only go out when something
  // changes (a rate, a block), never on a timer, and HostPlatform-imported bookings never call Channex: weeks of
  // silence are normal (prod, 19 Oct–13 Nov 2026: 0 queued, 0 failed), so only refused updates warn.
  const sentDays = channelSync?.lastSentAt ? Math.floor((Date.now() - Date.parse(channelSync.lastSentAt)) / 864e5) : 0;
  const syncWarn = !!channelSync?.failed;
  const syncText = channelSync?.failed ? 'Channel updates need attention'
    : channelSync?.lastSentAt ? `Sent to channels ${sentDays >= 2 ? `${sentDays} days ago` : relative(channelSync.lastSentAt).toLowerCase()}`
    : 'Channels connected';

  /* The search button goes icon-only when its label would be cut short (the SegmentedRow pattern in Metric.tsx):
     it comes back once the space around it is wider than when it went. */
  const searchLabel = useRef<HTMLSpanElement>(null);
  const searchRow = useRef<HTMLDivElement>(null);
  const [searchIcon, setSearchIcon] = useState(false);
  const searchIconAt = useRef(0);
  useLayoutEffect(() => {
    const el = searchLabel.current;
    if (el && el.scrollWidth > el.clientWidth + 1) { searchIconAt.current = searchRow.current?.clientWidth ?? 0; setSearchIcon(true); }
  });
  useEffect(() => {
    const row = searchRow.current;
    if (compact || !row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (row.clientWidth > searchIconAt.current + 1) setSearchIcon(false); });
    ro.observe(row);
    return () => ro.disconnect();
  }, [compact]);
  const searchSquare = compact || searchIcon;

  /* The Beta screens wear the glass look of the Project Workspace designs (v10 light, v13 night): the bar floats as a
     glass pill, as the designs draw their top bar. The colour tokens are re-set on the bar only, so the search box,
     the theme switch and the bell follow it without changing anywhere else. The View as button keeps its amber: it
     warns that the screen is being seen as someone else. */
  const dc = !compact && path.startsWith('/beta');
  const look = LOOKS[sidebarLookKey(true, useDarkTheme())];
  const dcBar = {
    flex: 'none', margin: '16px 24px 4px', padding: '8px 12px 8px 22px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'nowrap',
    borderRadius: radius.pill, ...look.card, color: look.text,
    '--color-card': look.wash, '--color-line': look.rule, '--color-ink': look.textOn,
    '--color-muted-ink': look.muted, '--color-faint': look.faint, '--color-muted': look.wash,
    // White on the bell's red count, in both themes (the dark theme's inverse text is near black).
    '--color-text-inverse': look.avatarInk,
  } as CSSProperties;
  // The bell's panel: the same glass, with its rows left see-through and its text, lines and link in the glass colours.
  const glassPanel = {
    ...look.card,
    '--color-card': 'transparent', '--color-gold-tint': look.wash, '--color-line': look.rule, '--color-line-soft': look.divider,
    '--color-muted': look.wash, '--color-ink': look.textOn, '--color-ink-2': look.text, '--color-muted-ink': look.muted,
    '--color-faint': look.faint, '--color-gold-ink': look.dot,
  } as CSSProperties;
  // The glass blur makes the bar the anchor of anything fixed inside it, so the search overlay goes to the page body.
  const inBody = (overlay: ReactElement): ReactNode => (dc ? createPortal(overlay, document.body) : overlay);

  return (
    <div data-print-hide style={compact
      ? { flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }
      : dc ? dcBar
      : { flex: 'none', background: color.card, borderBottom: `1px solid ${color.border}`, padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      {!compact && <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        {(() => {
          const crumbs = nav ? [nav.group, ...(nav.group !== nav.item ? [nav.item] : []), ...(nav.label !== nav.item ? [nav.label] : []), ...(nav.page ? [nav.page] : [])] : [path === '/account' ? 'My account' : path === '/notifications' ? 'Notifications' : 'Home'];
          return crumbs.map((c, i) => (
            <Fragment key={`${c}-${i}`}>
              {i > 0 && <span aria-hidden style={{ fontSize: text.meta, color: color.faint, flex: 'none' }}>/</span>}
              <span style={{ fontSize: text.meta, fontWeight: i === crumbs.length - 1 ? 600 : 400, color: i === crumbs.length - 1 ? color.ink : color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</span>
            </Fragment>
          ));
        })()}
      </nav>}

      <div ref={searchRow} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: compact ? 'none' : '1 1 auto', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
        <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" aria-keyshortcuts="/ Control+K Meta+K" title={searchIcon ? 'Search' : undefined}
          style={searchSquare
            ? { width: ctl, height: ctl, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: `1px solid ${color.border}`, borderRadius: dc ? radius.pill : radius.control, background: color.card, color: color.ink, cursor: 'pointer' }
            : { display: 'flex', alignItems: 'center', gap: 8, height: shell.controlSm, padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: dc ? radius.pill : radius.control, background: color.card, color: color.textMuted, flex: '0 1 260px', minWidth: 44, overflow: 'hidden', cursor: 'text', font: 'inherit', textAlign: 'left' }}>
          <Icon name="Search" size={compact ? 'nav' : 'sm'} />
          {!searchSquare && <span ref={searchLabel} style={{ fontSize: text.copy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search anything</span>}
          {!searchSquare && <span style={{ marginLeft: 'auto', fontSize: text.micro, color: color.faint, flex: 'none' }}>{isMac ? '⌘K' : 'Ctrl K'}</span>}
        </button>

        {/* Shown only when units are really connected to a booking site; never a fixed figure. */}
        {channelSync && channelSync.units > 0 && (
          <Link to="/system/integrations" title={`${syncText} · open Integrations`} aria-label={compact ? syncText : undefined}
            style={compact
              ? { position: 'relative', width: ctl, height: ctl, flex: 'none', display: 'grid', placeItems: 'center', boxSizing: 'border-box', border: `1px solid ${color.border}`, borderRadius: radius.control, color: color.ink }
              : { display: 'flex', alignItems: 'center', gap: 7, height: shell.controlSm, flex: 'none', padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: radius.control, fontSize: text.small, whiteSpace: 'nowrap', color: color.textMuted, textDecoration: 'none' }}>
            {/* Phone: a sync icon says what the control is; the dot on its corner says how it stands. */}
            {compact && <Icon name="RefreshCw" size="nav" />}
            <span className={syncWarn ? undefined : 'animate-live'} style={{ width: compact ? 8 : 6, height: compact ? 8 : 6, borderRadius: radius.pill, background: syncWarn ? 'var(--color-warning-line)' : 'var(--color-success-line)', ...(compact && { position: 'absolute', top: 6, right: 6, boxShadow: `0 0 0 2px ${color.card}` }) }} />
            {!compact && <span>{syncText}</span>}
          </Link>
        )}

        <Suspense fallback={null}><ViewAs docked /></Suspense>
        <DemoButton size={ctl} iconOnly={compact} />
        <ThemeButton size={ctl} />
        <NotificationBell path={path} navigate={go} size={ctl} glass={dc ? glassPanel : undefined} />

        {action && (
          <button type="button" onClick={action.onClick} aria-label={action.label} title={compact ? action.label : undefined}
            style={{ height: ctl, width: compact ? ctl : undefined, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: compact ? 0 : '0 14px', borderRadius: radius.control, background: dc ? color.black : 'var(--color-brand-black)', color: 'var(--color-text-inverse)', fontSize: text.copy, fontWeight: 500, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', transition: `background ${motion.fast} ease-out` }}>
            <Icon name="Plus" size="sm" />
            {!compact && <span style={{ whiteSpace: 'nowrap' }}>{action.label}</span>}
          </button>
        )}
      </div>

      {/* --------------------------- search overlay --------------------------- */}
      {searchOpen && inBody(
        <Suspense fallback={null}><GlobalSearch compact={compact} onClose={() => setSearchOpen(false)} go={go} /></Suspense>
      )}
    </div>
  );
}
