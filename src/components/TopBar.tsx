import { useEffect, useMemo, useRef, useState } from 'react';
import { color, radius, text, shell, motion, shadow } from '../theme';
import { findNav } from '../lib/navigation';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import Icon from './Icon';

/* ------------------------------------------------------------------ *
 * Application shell top bar (BUTTONS.md §2).
 *  - Global search: opens on `/`, queries GET /api/search?q= through
 *    useApi (with a dev fallback), navigates to the chosen result,
 *    escape-to-close, arrow-key + Enter selection.
 *  - Notification bell: dropdown fed by GET /api/notifications, unread
 *    dot, each item navigates to its durable target, "Mark all read"
 *    posts /notifications/read optimistically.
 * No backend runs in dev, so reads fall back to the constants below and
 * writes are fired into a swallowed try/catch — the same idiom the pages
 * use. Round-trips are therefore UNTESTED.
 * ------------------------------------------------------------------ */

type SearchKind = 'unit' | 'guest' | 'reservation' | 'owner';
interface SearchResult { id: string; label: string; sub: string; kind: SearchKind; target: string }

interface Notif { id: string; title: string; body: string; target: string; at: string; readAt: string | null }

/** GET /api/notifications answers { data: notification_log rows }, not a bare list. */
interface NotifPayload { data?: { id: string; template: string; queued_at: string; sent_at: string | null }[] }

function toNotifs(raw: Notif[] | NotifPayload | null): Notif[] | null {
  if (Array.isArray(raw)) return raw;
  if (!raw || !Array.isArray(raw.data)) return null;
  return raw.data.map(r => ({
    id: String(r.id),
    title: r.template.replace(/[._]/g, ' ').replace(/^./, c => c.toUpperCase()),
    body: '', target: '/', at: (r.queued_at ?? '').slice(11, 16), readAt: r.sent_at,
  }));
}

/** Dev fallback so the palette renders without a backend; a live API returns
 *  the same shape already scoped to the signed-in role. */
const SEARCH_FALLBACK: SearchResult[] = [
  { id: 'u1', kind: 'unit', label: 'The Establishment #A-21-02', sub: 'Unit · 2BR · occupied', target: '/properties/units/A-21-02' },
  { id: 'u2', kind: 'unit', label: 'Vista Jaya One #A-12-03', sub: 'Unit · 1BR · ready', target: '/properties/units/A-12-03' },
  { id: 'g1', kind: 'guest', label: 'Nadia Abdullah', sub: 'Guest · checked in · Airbnb', target: '/reservations/guests' },
  { id: 'g2', kind: 'guest', label: 'Aaron Lee', sub: 'Guest · arriving today · direct', target: '/reservations/guests' },
  { id: 'r1', kind: 'reservation', label: 'HMX-4471 · Nadia Abdullah', sub: 'Reservation · 13–16 Sep', target: '/reservations/bookings' },
  { id: 'o1', kind: 'owner', label: 'Lim Chee Keong', sub: 'Owner · 3 units', target: '/owners' },
];

const NOTIF_FALLBACK: Notif[] = [
  { id: 'n1', title: 'Check-in at risk', body: 'The Establishment #A-21-02 is dirty with no cleaner. Guest arrives 15:00.', target: '/operations/today', at: '14:12', readAt: null },
  { id: 'n2', title: 'Airbnb sync complete', body: '3 new reservations pulled, 1 changed.', target: '/reservations/calendar', at: '14:06', readAt: null },
  { id: 'n3', title: 'Statement ready to send', body: 'August statements finalised for 2 owners.', target: '/finance/statements', at: '09:40', readAt: '2026-09-20T01:40:00Z' },
];

const KIND_ICON: Record<SearchKind, string> = {
  unit: 'Building2', guest: 'User', reservation: 'CalendarDays', owner: 'Users',
};

export default function TopBar({
  path, navigate, action,
}: { path: string; navigate?: (p: string) => void; action?: { label: string; onClick: () => void } }) {
  const nav = findNav(path);
  const go = (p: string) => navigate?.(p);

  /* --------------------------- search --------------------------- */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reads GET /api/search?q=; the fallback keeps the palette populated in dev.
  const { data: searchData } = useApi<SearchResult[]>(`/search?q=${encodeURIComponent(query.trim())}`, SEARCH_FALLBACK);

  const results = useMemo(() => {
    const source = searchData ?? (import.meta.env.DEV ? SEARCH_FALLBACK : []);
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter(r => `${r.label} ${r.sub}`.toLowerCase().includes(q));
  }, [searchData, query]);

  useEffect(() => { setActive(0); }, [query, searchOpen]);

  // `/` focuses search from anywhere, unless the user is already typing.
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

  const closeSearch = () => { setSearchOpen(false); setQuery(''); };
  const chooseResult = (r: SearchResult | undefined) => { if (!r) return; closeSearch(); go(r.target); };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseResult(results[active]); }
  };

  /* ------------------------ notifications ------------------------ */
  const [bellOpen, setBellOpen] = useState(false);
  const [readIds, setReadIds] = useState<Record<string, boolean>>({});

  const { data: notifRaw } = useApi<Notif[] | NotifPayload>('/notifications', NOTIF_FALLBACK);
  const notifData = useMemo(() => toNotifs(notifRaw), [notifRaw]);
  const notifs = useMemo(() => (notifData ?? (import.meta.env.DEV ? NOTIF_FALLBACK : [])).map(n => ({
    ...n, read: readIds[n.id] ?? !!n.readAt,
  })), [notifData, readIds]);
  const unread = notifs.filter(n => !n.read).length;

  const markAllRead = () => {
    setReadIds(prev => {
      const next = { ...prev };
      for (const n of notifs) next[n.id] = true;
      return next;
    });
    api.post('/notifications/read').catch(() => { /* dev: no backend */ });
  };

  const openNotif = (n: Notif) => {
    setReadIds(prev => ({ ...prev, [n.id]: true }));
    setBellOpen(false);
    go(n.target);
  };

  return (
    <div style={{ flex: 'none', background: '#FFFFFF', borderBottom: `1px solid ${color.border}`, padding: '16px 28px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      {/* Crumbs truncate inside their own box; the actions cluster never shrinks. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        <span style={{ fontSize: text.small, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nav?.group ?? 'Workspace'}</span>
        <span style={{ fontSize: text.small, color: color.borderStrong, flex: 'none' }}>/</span>
        <span style={{ fontSize: text.small, fontWeight: 600, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nav?.label ?? 'Dashboard'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
        <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" aria-keyshortcuts="/"
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: shell.controlSm, padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: radius.control, background: '#FFFFFF', color: color.textMuted, flex: '0 1 210px', minWidth: 44, overflow: 'hidden', cursor: 'text', font: 'inherit', textAlign: 'left' }}>
          <Icon name="Search" size="sm" />
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search</span>
          <span style={{ marginLeft: 'auto', fontSize: text.micro, color: color.faint, flex: 'none' }}>/</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: shell.controlSm, flex: 'none', padding: '0 12px', border: `1px solid ${color.border}`, borderRadius: radius.control, fontSize: text.small, whiteSpace: 'nowrap', color: color.textMuted }}>
          <span className="animate-live" style={{ width: 6, height: 6, borderRadius: radius.pill, background: '#16845B' }} />
          <span>Airbnb synced 14:06</span>
        </div>

        <div style={{ position: 'relative', flex: 'none' }}>
          <button aria-label="Notifications" aria-expanded={bellOpen} onClick={() => setBellOpen(v => !v)}
            style={{ position: 'relative', width: shell.controlSm, height: shell.controlSm, flex: 'none', display: 'grid', placeItems: 'center', border: `1px solid ${color.border}`, borderRadius: radius.control, background: '#FFFFFF', color: color.ink, cursor: 'pointer' }}>
            <Icon name="Bell" size="nav" />
            {unread > 0 && <span style={{ position: 'absolute', top: 6, right: 7, width: 6, height: 6, borderRadius: radius.pill, background: '#C2413B' }} />}
          </button>

          {bellOpen && (
            <>
              <div onClick={() => setBellOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 41, width: 340, maxWidth: '90vw', background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: shadow.overlay, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: text.body, fontWeight: 600, color: color.ink }}>Notifications</span>
                  <button type="button" onClick={markAllRead} disabled={unread === 0}
                    style={{ fontSize: text.small, color: unread === 0 ? color.faint : color.inkSecondary, background: 'none', border: 'none', cursor: unread === 0 ? 'default' : 'pointer', font: 'inherit', padding: 0 }}>
                    Mark all read
                  </button>
                </div>
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {notifs.length === 0 ? (
                    <div style={{ padding: '20px 16px', fontSize: text.small, color: color.textMuted }}>You are all caught up.</div>
                  ) : notifs.map(n => (
                    <button key={n.id} type="button" role="menuitem" onClick={() => openNotif(n)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', width: '100%', border: 'none', borderBottom: `1px solid ${color.borderMuted}`, background: n.read ? '#FFFFFF' : color.goldTint, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                      <span style={{ marginTop: 5, width: 6, height: 6, flex: 'none', borderRadius: radius.pill, background: n.read ? 'transparent' : '#C2413B' }} />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: n.read ? 500 : 600, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</span>
                          <span style={{ fontSize: text.micro, color: color.faint, flex: 'none' }}>{n.at}</span>
                        </span>
                        <span style={{ fontSize: text.small, color: color.textMuted, lineHeight: 1.45, whiteSpace: 'normal' }}>{n.body}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {action && (
          <button onClick={action.onClick}
            style={{ height: shell.controlSm, flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', transition: `background ${motion.fast} ease-out` }}>
            <Icon name="Plus" size="sm" />
            <span style={{ whiteSpace: 'nowrap' }}>{action.label}</span>
          </button>
        )}
      </div>

      {/* --------------------------- search overlay --------------------------- */}
      {searchOpen && (
        <div onClick={closeSearch}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(21,21,21,0.24)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 16px 16px' }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Search"
            style={{ width: 560, maxWidth: '100%', background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: shadow.overlay, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${color.borderMuted}` }}>
              <Icon name="Search" size="nav" color={color.textMuted} />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKeyDown}
                placeholder="Search units, guests, reservations, owners"
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: text.body, color: color.ink, font: 'inherit' }} />
              <span style={{ fontSize: text.micro, color: color.faint, flex: 'none' }}>Esc</span>
            </div>
            <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
              {results.length === 0 ? (
                <div style={{ padding: '20px 12px', fontSize: text.small, color: color.textMuted }}>No matches for “{query.trim()}”.</div>
              ) : results.map((r, i) => (
                <button key={r.id} type="button" onClick={() => chooseResult(r)} onMouseEnter={() => setActive(i)}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', width: '100%', border: 'none', borderRadius: radius.control, background: i === active ? color.muted : 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                  <span style={{ width: 30, height: 30, flex: 'none', borderRadius: radius.sm, background: color.sunken, color: color.inkSecondary, display: 'grid', placeItems: 'center' }}>
                    <Icon name={KIND_ICON[r.kind]} size="sm" />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                    <span style={{ fontSize: text.micro, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
