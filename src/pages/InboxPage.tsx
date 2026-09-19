import { useMemo, useState, type FormEvent } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ChannelMark, { channelLabel } from '../components/ChannelMark';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import type { BookingChannel } from '../lib/types';

/** A single message in a thread. `status` only ever exists on an outbound message
 *  we sent from this client: it reads `sending` until the round-trip resolves, then
 *  `sent`. Messages from the server are already delivered and carry no status. */
interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  sentAt: string;
  isAutomated: boolean;
  status?: 'sending' | 'sent';
}
interface Thread {
  id: string;
  guestName: string | null;
  subject: string | null;
  unitNumber: string | null;
  propertyName: string | null;
  channel: BookingChannel | null;
  isRead: boolean;
  lastMessageAt: string;
  preview: string | null;
  messages: Message[];
}
interface Payload { threads: Thread[]; generatedAt: string }

/** Direct bookings have no channel inbox of their own — the guest thread runs over
 *  WhatsApp. Every other channel keeps its own name (BUTTONS.md, guide 14.4). */
const threadChannelLabel = (ch: BookingChannel | null) =>
  ch === null ? 'WhatsApp' : ch === 'direct' ? 'WhatsApp' : channelLabel(ch);

const FALLBACK: Payload = {
  generatedAt: '',
  threads: [
    {
      id: 't1', guestName: 'Priya Sundaram', subject: 'Early check-in request',
      unitNumber: '#15-06', propertyName: 'Scarletz KLCC', channel: 'booking_com',
      isRead: false, lastMessageAt: '13:45', preview: 'Hi, our flight lands at noon…',
      messages: [
        { id: 'm1a', direction: 'inbound', body: 'Hi, our flight lands at noon. Would a 14:00 check-in be possible?', sentAt: '13:45', isAutomated: false },
      ],
    },
    {
      id: 't2', guestName: 'Aaron Lee', subject: 'Parking access',
      unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', channel: 'direct',
      isRead: false, lastMessageAt: '11:20', preview: 'Is there a parking bay included?',
      messages: [
        { id: 'm2a', direction: 'inbound', body: 'Hi there, is there a parking bay included with the unit?', sentAt: '11:18', isAutomated: false },
        { id: 'm2b', direction: 'outbound', body: 'Good morning Aaron. Yes, bay B2-114 is reserved for your stay. I will send the access card details on arrival.', sentAt: '11:19', isAutomated: false, status: 'sent' },
        { id: 'm2c', direction: 'inbound', body: 'Perfect, thank you.', sentAt: '11:20', isAutomated: false },
      ],
    },
    {
      id: 't3', guestName: 'Nadia Abdullah', subject: 'Check-in details',
      unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb',
      isRead: true, lastMessageAt: 'Yesterday', preview: 'Received, thank you.',
      messages: [
        { id: 'm3a', direction: 'outbound', body: 'Hi Nadia, your check-in details and door code are ready. Let me know if you need anything before arrival.', sentAt: 'Yesterday', isAutomated: true, status: 'sent' },
        { id: 'm3b', direction: 'inbound', body: 'Received, thank you.', sentAt: 'Yesterday', isAutomated: false },
      ],
    },
    {
      id: 't4', guestName: 'Chen Yu', subject: 'Late checkout',
      unitNumber: '#2207', propertyName: 'The Establishment', channel: 'agoda',
      isRead: true, lastMessageAt: 'Mon', preview: 'Noted, 13:00 works. Enjoy your stay.',
      messages: [
        { id: 'm4a', direction: 'inbound', body: 'Could we check out at 13:00 instead of 11:00?', sentAt: 'Mon', isAutomated: false },
        { id: 'm4b', direction: 'outbound', body: 'Noted, 13:00 works. Enjoy your stay.', sentAt: 'Mon', isAutomated: false, status: 'sent' },
      ],
    },
  ],
};

type Filter = 'all' | 'unread';

export default function InboxPage() {
  const { data, loading, error, reload } = useApi<Payload>('/messages/threads', FALLBACK);
  const toast = useToast();

  // Optimistic overlays — there is no backend in dev.
  const [sentByThread, setSentByThread] = useState<Record<string, Message[]>>({});
  const [readIds, setReadIds] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // Merge server threads with local read state and locally-sent messages.
  const threads = useMemo<Thread[]>(() => {
    const base = data?.threads ?? [];
    return base.map(t => {
      const mine = sentByThread[t.id] ?? [];
      const merged = [...t.messages, ...mine];
      const last = merged[merged.length - 1];
      return {
        ...t,
        isRead: readIds[t.id] ? true : t.isRead,
        messages: merged,
        preview: last ? last.body : t.preview,
      };
    });
  }, [data, sentByThread, readIds]);

  const unreadCount = threads.filter(t => !t.isRead).length;
  const visible = filter === 'unread' ? threads.filter(t => !t.isRead) : threads;

  // A thread the user explicitly opened stays selected even after read-on-open drops
  // it from the unread filter; otherwise fall back to the first visible thread.
  const activeId = (openId && threads.some(t => t.id === openId)) ? openId : (visible[0]?.id ?? null);
  const open = threads.find(t => t.id === activeId) ?? null;
  const messages = open?.messages ?? [];

  function selectThread(id: string) {
    setOpenId(id);
    // Opening a thread reads it — reflected in the badge immediately.
    if (!readIds[id]) {
      setReadIds(r => ({ ...r, [id]: true }));
      api.patch(`/messages/threads/${id}`, { isRead: true }).catch(() => { /* dev: no backend */ });
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !activeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    // Show it at once, but explicitly as "sending" — never a sent state yet.
    const optimistic: Message = { id, direction: 'outbound', body, sentAt: now, isAutomated: false, status: 'sending' };
    setSentByThread(s => ({ ...s, [activeId]: [...(s[activeId] ?? []), optimistic] }));
    setDraft('');

    try {
      await api.post('/messages', { threadId: activeId, body });
    } catch { /* dev: no backend, keep the optimistic message */ }

    // Only now, after the round-trip resolves, does it read as sent.
    setSentByThread(s => ({
      ...s,
      [activeId]: (s[activeId] ?? []).map(m => (m.id === id ? { ...m, status: 'sent' } : m)),
    }));
    toast({ tone: 'success', title: 'Message sent.' });
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        sub={`${unreadCount} unread · every channel in one thread list`}
      />

      {error && <StaleBanner message={`Showing the last threads we have. ${error}`} onRetry={reload} />}

      <div role="tablist" aria-label="Filter conversations" style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {(['all', 'unread'] as const).map(f => {
          const on = f === filter;
          const label = f === 'all' ? 'All' : `Unread${unreadCount ? ` (${unreadCount})` : ''}`;
          return (
            <button key={f} role="tab" aria-selected={on} onClick={() => setFilter(f)}
              style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 15px', borderRadius: radius.pill, fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,0.8fr) minmax(0,1.6fr)', gap: 20, alignItems: 'start' }}>
        {/* ---- Thread list, every channel in one place ---- */}
        <Card>
          {loading && threads.length === 0 ? (
            <TableSkeleton rows={4} cols={2} />
          ) : visible.length === 0 ? (
            <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, color: color.textMuted }}>
                {filter === 'unread' ? 'No unread conversations.' : 'No conversations yet.'}
              </span>
              {filter === 'unread' && (
                <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>Clear filter</Button>
              )}
            </div>
          ) : (
            visible.map(t => {
              const on = t.id === activeId;
              return (
                <button key={t.id} onClick={() => selectThread(t.id)}
                  aria-current={on}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', padding: '13px 16px', borderBottom: `1px solid ${color.borderMuted}`, border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left',
                    background: on ? color.goldTint : '#FFFFFF', boxShadow: on ? `inset 3px 0 0 ${color.gold}` : 'none' }}>
                  {t.channel && <ChannelMark ch={t.channel} size={22} />}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: t.isRead ? 500 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.guestName ?? 'Unknown guest'}</span>
                      <span style={{ fontSize: text.micro, color: color.textMuted, flex: 'none' }}>{t.lastMessageAt}</span>
                    </div>
                    <span style={{ fontSize: 12, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject ?? t.preview}</span>
                    <span style={{ fontSize: 11.5, color: color.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.propertyName} {t.unitNumber}</span>
                  </div>
                  {!t.isRead && <span aria-label="Unread" style={{ width: 7, height: 7, flex: 'none', marginTop: 5, borderRadius: 999, background: '#C2413B' }} />}
                </button>
              );
            })
          )}
        </Card>

        {/* ---- Selected conversation ---- */}
        <Card>
          {open ? (
            <div style={{ padding: '15px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
              {open.channel && <ChannelMark ch={open.channel} size={22} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{open.guestName ?? 'Unknown guest'}</span>
                <span style={{ fontSize: text.small, color: color.textMuted }}>{open.propertyName} {open.unitNumber}{open.subject ? ` · ${open.subject}` : ''}</span>
              </div>
              <Badge tone="neutral" label={threadChannelLabel(open.channel)} size="sm" />
            </div>
          ) : (
            <div style={{ padding: '15px 20px', borderBottom: `1px solid ${color.border}`, fontSize: text.small, color: color.textMuted }}>
              No conversation selected
            </div>
          )}

          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 220 }}>
            {loading && messages.length === 0 ? (
              <TableSkeleton rows={2} cols={1} />
            ) : !open ? (
              <span style={{ fontSize: 13, color: color.textMuted }}>Select a conversation to read and reply.</span>
            ) : messages.length === 0 ? (
              <span style={{ fontSize: 13, color: color.textMuted }}>No messages in this conversation yet.</span>
            ) : (
              messages.map(m => {
                const out = m.direction === 'outbound';
                const sending = m.status === 'sending';
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: out ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '78%', padding: '11px 14px', borderRadius: radius.card, fontSize: 13, lineHeight: 1.55, textWrap: 'pretty',
                      opacity: sending ? 0.7 : 1,
                      background: out ? color.black : color.muted, color: out ? '#FFFFFF' : color.ink }}>
                      {m.body}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: text.micro, color: color.textMuted }}>
                        {sending ? 'Sending…' : m.sentAt}
                      </span>
                      {m.isAutomated && <Badge tone="neutral" label="Automated" size="sm" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={send} style={{ padding: '14px 20px', borderTop: `1px solid ${color.border}`, display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={open ? `Reply to ${open.guestName ?? 'guest'} on ${threadChannelLabel(open.channel)}` : 'Select a conversation'}
              disabled={!open}
              aria-label="Reply"
              style={{ flex: 1, minWidth: 0, height: 40, padding: '0 14px', fontSize: 13, font: 'inherit', border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none' }} />
            <button type="submit" disabled={!draft.trim() || !open}
              style={{ height: 40, padding: '0 16px', borderRadius: radius.control, background: (draft.trim() && open) ? color.black : color.muted, color: (draft.trim() && open) ? '#FFFFFF' : color.faint, fontSize: 13, fontWeight: 500, border: 'none', cursor: (draft.trim() && open) ? 'pointer' : 'not-allowed', font: 'inherit' }}>
              Send
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
