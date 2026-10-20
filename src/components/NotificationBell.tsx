import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, radius, text, shadow } from '../theme';
import { api } from '../lib/api';
import { relative, dateTime } from '../lib/format';
import { useNavCounts } from '../lib/navBadges';
import { useSession } from '../lib/session';
import Icon from './Icon';

/* ------------------------------------------------------------------ *
 * The bell in the top bar. The badge is the signed-in person's unread notices
 * (GET /api/notifications/count, polled every minute and when the tab comes back);
 * the dropdown lists the latest ones above the live alerts the menu also counts.
 * Opening a notice marks it read and goes to its record. The full list is /notifications.
 * ------------------------------------------------------------------ */

export interface Notice {
  id: string; kind: string; title: string; body: string | null; link: string | null;
  entityTable: string | null; entityId: string | null; readAt: string | null; createdAt: string;
}
export interface NoticePage { data: Notice[]; total: number; unread: number; page: number; pageSize: number }

/** Other screens (the Notifications page) say when they changed what is read, so the badge follows at once. */
export const NOTICES_CHANGED = 'conts:notifications-changed';
export const announceNoticesChanged = () => window.dispatchEvent(new Event(NOTICES_CHANGED));

const POLL_MS = 60_000;
const PANEL_W = 380;
const PANEL_GAP = 16;
const TONE_DOT = { critical: 'var(--color-critical-line)', warning: 'var(--color-warning-line)', info: 'var(--color-info-line)' } as const;

/** Icon by what the notice is about. */
export function noticeIcon(kind: string) {
  if (kind.startsWith('booking.')) return 'CalendarDays';
  if (kind.startsWith('cleaning.')) return 'Sparkles';
  if (kind.startsWith('maintenance.')) return 'Wrench';
  if (kind.startsWith('approval.')) return 'BadgeCheck';
  if (kind.startsWith('statement.') || kind.startsWith('payout.')) return 'Receipt';
  if (kind.startsWith('digest.')) return 'Sun';
  return 'Bell';
}

export function useUnreadNotices() {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    api.get<{ unread: number }>('/notifications/count').then(r => setUnread(r.unread ?? 0)).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(NOTICES_CHANGED, refresh);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener(NOTICES_CHANGED, refresh); };
  }, [refresh]);
  return { unread, setUnread, refresh };
}

export function NoticeRow({ n, onOpen, wide = false }: { n: Notice; onOpen: (n: Notice) => void; wide?: boolean }) {
  const unread = !n.readAt;
  return (
    <button type="button" onClick={() => onOpen(n)}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: wide ? '12px 20px' : '10px 16px', width: '100%', border: 'none', borderBottom: `1px solid ${color.borderMuted}`, background: unread ? color.goldTint : color.card, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
      <span style={{ width: 28, height: 28, flex: 'none', borderRadius: radius.pill, background: unread ? color.card : color.muted, border: `1px solid ${color.borderMuted}`, display: 'grid', placeItems: 'center', color: color.inkSecondary }}>
        <Icon name={noticeIcon(n.kind)} size="sm" />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: text.copy, fontWeight: unread ? 600 : 500, color: color.ink, minWidth: 0, overflowWrap: 'anywhere' }}>{n.title}</span>
          <span title={dateTime(n.createdAt)} style={{ fontSize: text.micro, color: color.faint, flex: 'none', whiteSpace: 'nowrap' }}>{relative(n.createdAt)}</span>
        </span>
        {n.body && <span style={{ fontSize: text.meta, color: color.textMuted, lineHeight: 1.45, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{n.body}</span>}
      </span>
      <span aria-label={unread ? 'Unread' : undefined} style={{ marginTop: 6, width: 7, height: 7, flex: 'none', borderRadius: radius.pill, background: unread ? 'var(--color-critical-line)' : 'transparent' }} />
    </button>
  );
}

type Alert = NonNullable<NonNullable<ReturnType<typeof useNavCounts>>['alerts']>[number];

/** The desk bell: the person's notices and the live alerts the menu counts. */
export default function NotificationBell({ path, navigate, size }: { path: string; navigate: (p: string) => void; size: number }) {
  const counts = useNavCounts(path);
  return <Bell navigate={navigate} size={size} alerts={counts?.alerts ?? []} />;
}

/** The field app's bell (dark header): the person's own notices only; their app has one screen, so no "See all". */
export function FieldNotificationBell() {
  const { user } = useSession();
  const navigate = useNavigate();
  const field = user?.role === 'housekeeper' || user?.role === 'technician';
  // The field app is one screen, so a notice opens its job there (FieldHome reads ?task / ?repair), not the office page in its link.
  const target = (n: Notice) => !field || !n.entityId ? null
    : n.entityTable === 'tasks' ? `/?task=${encodeURIComponent(n.entityId)}`
    : n.entityTable === 'maintenance_issues' ? `/?repair=${encodeURIComponent(n.entityId)}` : null;
  return <Bell navigate={navigate} target={target} size={44} alerts={[]} dark />;
}

function Bell({ navigate, target, size, alerts, dark = false }: { navigate: (p: string) => void; target?: (n: Notice) => string | null; size: number; alerts: Alert[]; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  // How far the panel slides right of the bell so it stays on screen: in the field header the bell is not the last icon.
  const [shift, setShift] = useState(0);
  const { unread, setUnread, refresh } = useUnreadNotices();
  const [list, setList] = useState<Notice[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const attention = alerts.filter(a => a.tone !== 'info').length;

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.get<NoticePage>('/notifications', { pageSize: 8 })
      .then(r => { if (live) { setList(r.data); setUnread(r.unread); setLoadError(false); } })
      .catch(() => { if (live) setLoadError(true); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { live = false; document.removeEventListener('keydown', onKey); };
  }, [open, setUnread]);

  const go = (target: string) => { setOpen(false); navigate(target); };
  const openNotice = (n: Notice) => {
    if (!n.readAt) {
      setList(l => l?.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x) ?? null);
      setUnread(u => Math.max(0, u - 1));
      api.patch<{ unread: number }>('/notifications', { ids: [n.id] }).then(r => setUnread(r.unread)).catch(refresh);
    }
    const to = target ? target(n) : dark ? null : n.link;
    if (to) go(to);
  };
  const markAll = () => {
    setList(l => l?.map(x => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
    setUnread(0);
    api.patch('/notifications', { all: true }).then(() => announceNoticesChanged()).catch(refresh);
  };

  const badge = unread > 99 ? '99+' : String(unread);
  const label = unread ? `Notifications, ${unread} unread` : attention ? `Notifications, ${attention} need attention` : 'Notifications';

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button aria-label={label} aria-expanded={open} onClick={e => {
        const r = e.currentTarget.getBoundingClientRect();
        setShift(Math.max(0, PANEL_GAP + Math.min(PANEL_W, window.innerWidth - 2 * PANEL_GAP) - r.right));
        setOpen(v => !v);
      }}
        style={{ position: 'relative', width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center', border: dark ? '1px solid rgba(255,255,255,0.14)' : `1px solid ${color.border}`, borderRadius: radius.control, background: dark ? 'transparent' : color.card, color: dark ? color.onDark : color.ink, cursor: 'pointer' }}>
        <Icon name="Bell" size="nav" />
        {unread > 0
          ? <span aria-hidden style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: radius.pill, background: 'var(--color-critical-line)', color: color.card, fontSize: 10, fontWeight: 700, lineHeight: '18px', textAlign: 'center', border: `2px solid ${dark ? color.black : color.card}`, fontVariantNumeric: 'tabular-nums' }}>{badge}</span>
          : attention > 0 && <span aria-hidden style={{ position: 'absolute', top: 6, right: 7, width: 7, height: 7, borderRadius: radius.pill, background: 'var(--color-critical-line)' }} />}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div role="dialog" aria-label="Notifications" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: -shift, zIndex: 41, width: PANEL_W, maxWidth: `calc(100vw - ${2 * PANEL_GAP}px)`, background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: shadow.overlay, overflow: 'hidden', display: 'flex', flexDirection: 'column', whiteSpace: 'normal' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: text.copy, fontWeight: 600, color: color.ink }}>Notifications{unread ? ` (${unread})` : ''}</span>
              <button type="button" onClick={markAll} disabled={unread === 0} title={unread === 0 ? 'Nothing unread' : undefined}
                style={{ font: 'inherit', fontSize: text.small, color: unread === 0 ? color.faint : color.inkSecondary, background: 'none', border: 'none', cursor: unread === 0 ? 'default' : 'pointer', padding: '14px 0', margin: '-14px 0' }}>
                Mark all read
              </button>
            </div>
            <div style={{ maxHeight: 'min(440px, 60vh)', overflowY: 'auto' }}>
              {alerts.length > 0 && <div style={{ padding: '8px 16px 4px', fontSize: text.caption, fontWeight: 600, letterSpacing: '0.06em', color: color.textMuted }}>NEEDS ATTENTION</div>}
              {alerts.map(a => (
                <button key={a.key} type="button" onClick={() => go(a.target)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', width: '100%', border: 'none', borderBottom: `1px solid ${color.borderMuted}`, background: color.card, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                  <span style={{ marginTop: 5, width: 7, height: 7, flex: 'none', borderRadius: radius.pill, background: TONE_DOT[a.tone] }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: text.copy, fontWeight: 600, color: color.ink }}>{a.title}</span>
                    <span style={{ fontSize: text.meta, color: color.textMuted, lineHeight: 1.45, whiteSpace: 'normal' }}>{a.body}</span>
                  </span>
                  <Icon name="ChevronRight" size="sm" color={color.faint} style={{ marginTop: 3 }} />
                </button>
              ))}
              {alerts.length > 0 && <div style={{ padding: '8px 16px 4px', fontSize: text.caption, fontWeight: 600, letterSpacing: '0.06em', color: color.textMuted }}>FOR YOU</div>}
              {list === null && !loadError && <div style={{ padding: '18px 16px', fontSize: text.small, color: color.textMuted }}>Loading...</div>}
              {loadError && <div style={{ padding: '18px 16px', fontSize: text.small, color: color.textMuted }}>Your notifications could not load. Try again in a moment.</div>}
              {list?.map(n => <NoticeRow key={n.id} n={n} onOpen={openNotice} />)}
              {list && list.length === 0 && <div style={{ padding: '18px 16px', fontSize: text.small, color: color.textMuted }}>No notifications yet. New reservations, cleaning jobs and maintenance jobs that concern you appear here.</div>}
            </div>
            {!dark && <button type="button" onClick={() => go('/notifications')}
              style={{ font: 'inherit', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: color.card, border: 'none', borderTop: `1px solid ${color.borderMuted}`, padding: '11px 16px', cursor: 'pointer', textAlign: 'center' }}>
              See all notifications
            </button>}
          </div>
        </>
      )}
    </div>
  );
}
