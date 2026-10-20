import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { color, radius, text, shell, motion, shadow } from '../theme';
import { findNav } from '../lib/navigation';
import { useApi } from '../lib/useApi';
import { useNavCounts } from '../lib/navBadges';
import { dateRange, relative, titleCase } from '../lib/format';
import { stateLabel } from '../lib/vocabulary';
import type { BookingChannel } from '../lib/types';
import Icon from './Icon';
import ChannelMark from './ChannelMark';
import NotificationBell from './NotificationBell';

/* ------------------------------------------------------------------ *
 * Application shell top bar (BUTTONS.md §2).
 *  - Breadcrumbs: group / menu entry / page.
 *  - Global search: `/` opens it; GET /api/search?q= finds units, bookings (by Airbnb, Booking.com or
 *    Agoda reference, guest name, phone or email), guests and owners, grouped by kind.
 *  - Bell (NotificationBell): the person's unread notices with a count, plus the live alerts from /api/nav/badges.
 * ------------------------------------------------------------------ */

type SearchKind = 'unit' | 'guest' | 'reservation' | 'owner';
interface SearchResult {
  id: string; label: string; sub: string; kind: SearchKind; target: string;
  channel?: BookingChannel; state?: string; checkIn?: string; checkOut?: string; ref?: string | null;
}

/** Dev fallback so the palette renders without a backend. */
const SEARCH_FALLBACK: SearchResult[] = [
  { id: 'u1', kind: 'unit', label: 'The Establishment #A-21-02', sub: '2 bedrooms', state: 'occupied', target: '/properties/units/A-21-02' },
  { id: 'r1', kind: 'reservation', label: 'Nadia Abdullah', sub: 'Vista Jaya One #A-12-03', channel: 'airbnb', state: 'confirmed', checkIn: '2026-09-13', checkOut: '2026-09-16', ref: 'HMX4471', target: '/reservations/bookings' },
];

const KIND: Record<SearchKind, { icon: string; heading: string }> = {
  reservation: { icon: 'CalendarDays', heading: 'Reservations' },
  unit: { icon: 'Building2', heading: 'Units' },
  guest: { icon: 'User', heading: 'Guests' },
  owner: { icon: 'UserRound', heading: 'Owners' },
};
const KIND_ORDER: SearchKind[] = ['reservation', 'unit', 'guest', 'owner'];

/** The second line of a result, with dates and states in words ("13 Sep – 16 Sep 2026 · Confirmed"). */
function subline(r: SearchResult) {
  if (r.kind === 'reservation') {
    const parts = [r.checkIn && r.checkOut ? dateRange(r.checkIn, r.checkOut) : null, r.state ? stateLabel('reservation', r.state) : null, r.sub];
    return parts.filter(Boolean).join(' · ');
  }
  if (r.kind === 'unit' && r.state) return `${r.sub} · ${stateLabel('readiness', r.state)}`;
  return r.sub;
}

export default function TopBar({
  path, navigate, action, compact = false,
}: { path: string; navigate?: (p: string) => void; action?: { label: string; onClick: () => void };
  /** Phone: only the controls, as 40px squares, for the shell's mobile header row. */
  compact?: boolean }) {
  const nav = findNav(path);
  // The browser tab names the page, so tabs, history and screen readers can tell pages apart.
  const pageName = nav ? (nav.page ?? nav.label) : path === '/account' ? 'My account' : path === '/notifications' ? 'Notifications' : null;
  useEffect(() => { document.title = pageName ? `${pageName} · The Conts` : 'The Conts Property OS'; }, [pageName]);
  const ctl = compact ? 40 : shell.controlSm;
  const go = (p: string) => navigate?.(p);

  /* --------------------------- search --------------------------- */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = window.setTimeout(() => setDebounced(query.trim()), 200); return () => window.clearTimeout(t); }, [query]);
  const { data: searchData, loading: searching } = useApi<SearchResult[]>(searchOpen ? `/search?q=${encodeURIComponent(debounced)}` : null, SEARCH_FALLBACK);

  // The server has already matched; results are only grouped here (filtering again by label used to drop
  // every booking found by its reference, because the reference is not in the label).
  const results = useMemo(() => {
    const list = searchData ?? (import.meta.env.DEV ? SEARCH_FALLBACK : []);
    return KIND_ORDER.flatMap(k => list.filter(r => r.kind === k));
  }, [searchData]);

  useEffect(() => { setActive(0); }, [debounced, searchOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || searchOpen) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  useEffect(() => { if (searchOpen) inputRef.current?.focus(); }, [searchOpen]);

  const closeSearch = () => { setSearchOpen(false); setQuery(''); setDebounced(''); };
  const chooseResult = (r: SearchResult | undefined) => { if (!r) return; closeSearch(); go(r.target); };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseResult(results[active]); }
  };

  /* ------------------------ notifications ------------------------ */
  const counts = useNavCounts(path);
  const channelSync = counts?.channels;

  return (
    <div data-print-hide style={compact
      ? { flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }
      : { flex: 'none', background: color.card, borderBottom: `1px solid ${color.border}`, padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      {!compact && <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        {(() => {
          const crumbs = nav ? [nav.group, ...(nav.group !== nav.item ? [nav.item] : []), ...(nav.label !== nav.item ? [nav.label] : []), ...(nav.page ? [nav.page] : [])] : [path === '/account' ? 'My account' : path === '/notifications' ? 'Notifications' : 'Home'];
          return crumbs.map((c, i) => (
            <Fragment key={`${c}-${i}`}>
              {i > 0 && <span aria-hidden style={{ fontSize: text.meta, color: color.borderStrong, flex: 'none' }}>/</span>}
              <span style={{ fontSize: text.meta, fontWeight: i === crumbs.length - 1 ? 600 : 400, color: i === crumbs.length - 1 ? color.ink : color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</span>
            </Fragment>
          ));
        })()}
      </nav>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: compact ? 'none' : '1 1 auto', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
        <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" aria-keyshortcuts="/"
          style={compact
            ? { width: ctl, height: ctl, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: `1px solid ${color.border}`, borderRadius: radius.control, background: color.card, color: color.ink, cursor: 'pointer' }
            : { display: 'flex', alignItems: 'center', gap: 8, height: shell.controlSm, padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: radius.control, background: color.card, color: color.textMuted, flex: '0 1 260px', minWidth: 44, overflow: 'hidden', cursor: 'text', font: 'inherit', textAlign: 'left' }}>
          <Icon name="Search" size={compact ? 'nav' : 'sm'} />
          {!compact && <span style={{ fontSize: text.copy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search reservation ref, guest, unit</span>}
          {!compact && <span style={{ marginLeft: 'auto', fontSize: text.micro, color: color.faint, flex: 'none' }}>/</span>}
        </button>

        {/* Shown only when units are really connected to a booking site; never a fixed figure. */}
        {channelSync && channelSync.units > 0 && (
          <a href="#/system/integrations" title={channelSync.failed ? 'Channel updates need attention' : 'Channels connected · open Integrations'}
            aria-label={compact ? (channelSync.failed ? 'Channel updates need attention' : 'Channels connected') : undefined}
            style={compact
              ? { width: ctl, height: ctl, flex: 'none', display: 'grid', placeItems: 'center', boxSizing: 'border-box', border: `1px solid ${color.border}`, borderRadius: radius.control }
              : { display: 'flex', alignItems: 'center', gap: 7, height: shell.controlSm, flex: 'none', padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: radius.control, fontSize: text.small, whiteSpace: 'nowrap', color: color.textMuted, textDecoration: 'none' }}>
            <span className={channelSync.failed ? undefined : 'animate-live'} style={{ width: compact ? 8 : 6, height: compact ? 8 : 6, borderRadius: radius.pill, background: channelSync.failed ? 'var(--color-warning-line)' : 'var(--color-success-line)' }} />
            {!compact && <span>{channelSync.failed
              ? 'Channel updates need attention'
              : channelSync.lastSentAt ? `Sent to channels ${relative(channelSync.lastSentAt)}` : 'Channels connected'}</span>}
          </a>
        )}

        <NotificationBell path={path} navigate={go} size={ctl} />

        {action && (
          <button type="button" onClick={action.onClick} aria-label={action.label} title={compact ? action.label : undefined}
            style={{ height: ctl, width: compact ? ctl : undefined, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: compact ? 0 : '0 14px', borderRadius: radius.control, background: color.black, color: 'var(--color-text-inverse)', fontSize: text.copy, fontWeight: 500, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', transition: `background ${motion.fast} ease-out` }}>
            <Icon name="Plus" size="sm" />
            {!compact && <span style={{ whiteSpace: 'nowrap' }}>{action.label}</span>}
          </button>
        )}
      </div>

      {/* --------------------------- search overlay --------------------------- */}
      {searchOpen && (
        <div onClick={closeSearch}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(21,21,21,0.24)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: compact ? '8px' : '12vh 16px 16px' }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search"
            style={{ width: 600, maxWidth: '100%', background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: shadow.overlay, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${color.borderMuted}` }}>
              <Icon name="Search" size="nav" color={color.textMuted} />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKeyDown}
                placeholder="Reservation reference, guest, phone, unit or owner" aria-label="Search"
                style={{ font: 'inherit', flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: color.ink }} />
              <button type="button" onClick={closeSearch} aria-label="Close search" style={{ font: 'inherit', fontSize: compact ? text.meta : text.micro, color: color.textMuted, flex: 'none', border: `1px solid ${color.border}`, borderRadius: 4, background: 'none', padding: compact ? '0 12px' : '2px 6px', height: compact ? 36 : undefined, cursor: 'pointer' }}>{compact ? 'Close' : 'Esc'}</button>
            </div>
            {/* Never taller than the window (a phone's keyboard takes half of it). */}
            <div style={{ maxHeight: compact ? 'calc(100dvh - 80px)' : 'min(420px, calc(100dvh - 12vh - 90px))', overflowY: 'auto', overscrollBehavior: 'contain', padding: 6 }}>
              {results.length === 0 ? (
                <div style={{ padding: '20px 12px', fontSize: text.small, color: color.textMuted }}>
                  {searching || query.trim() !== debounced ? 'Searching...' : debounced ? `No matches for "${debounced}". Try the reservation reference from Airbnb or Booking.com, a guest name or a phone number.` : 'Type to search.'}
                </div>
              ) : results.map((r, i) => (
                <Fragment key={`${r.kind}-${r.id}`}>
                  {(i === 0 || results[i - 1].kind !== r.kind) && (
                    <div style={{ padding: '10px 12px 4px', fontSize: text.caption, fontWeight: 600, letterSpacing: '0.06em', color: color.textMuted, textTransform: 'uppercase' }}>{KIND[r.kind].heading}</div>
                  )}
                  <button type="button" onClick={() => chooseResult(r)} onMouseEnter={() => setActive(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', width: '100%', border: 'none', borderRadius: radius.control, background: i === active ? color.muted : 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                    {r.kind === 'reservation' && r.channel
                      ? <ChannelMark ch={r.channel} size={30} />
                      : <span style={{ width: 30, height: 30, flex: 'none', borderRadius: radius.sm, background: color.sunken, color: color.inkSecondary, display: 'grid', placeItems: 'center' }}><Icon name={KIND[r.kind].icon} size="sm" /></span>}
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: text.copy, fontWeight: 500, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.kind === 'owner' ? titleCase(r.label) : r.label}</span>
                      <span style={{ fontSize: text.meta, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subline(r)}</span>
                    </span>
                    {r.ref && <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: text.caption, color: color.inkSecondary, background: color.muted, borderRadius: 4, padding: '2px 6px' }}>{r.ref}</span>}
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
