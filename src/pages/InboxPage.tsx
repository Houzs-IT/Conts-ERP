import { useMemo, useState, type FormEvent } from 'react';
import { cx, TONE } from '../lib/design-tokens';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ChannelMark, { channelLabel } from '../components/ChannelMark';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { relative, time } from '../lib/format';
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
      isRead: false, lastMessageAt: '2026-09-22T13:45', preview: 'Hi, our flight lands at noon…',
      messages: [
        { id: 'm1a', direction: 'inbound', body: 'Hi, our flight lands at noon. Would a 14:00 check-in be possible?', sentAt: '2026-09-22T13:45', isAutomated: false },
      ],
    },
    {
      id: 't2', guestName: 'Aaron Lee', subject: 'Parking access',
      unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', channel: 'direct',
      isRead: false, lastMessageAt: '2026-09-22T11:20', preview: 'Is there a parking bay included?',
      messages: [
        { id: 'm2a', direction: 'inbound', body: 'Hi there, is there a parking bay included with the unit?', sentAt: '2026-09-22T11:18', isAutomated: false },
        { id: 'm2b', direction: 'outbound', body: 'Good morning Aaron. Yes, bay B2-114 is reserved for your stay. I will send the access card details on arrival.', sentAt: '2026-09-22T11:19', isAutomated: false, status: 'sent' },
        { id: 'm2c', direction: 'inbound', body: 'Perfect, thank you.', sentAt: '2026-09-22T11:20', isAutomated: false },
      ],
    },
    {
      id: 't3', guestName: 'Nadia Abdullah', subject: 'Check-in details',
      unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb',
      isRead: true, lastMessageAt: '2026-09-21T09:00', preview: 'Received, thank you.',
      messages: [
        { id: 'm3a', direction: 'outbound', body: 'Hi Nadia, your check-in details and door code are ready. Let me know if you need anything before arrival.', sentAt: '2026-09-21T08:58', isAutomated: true, status: 'sent' },
        { id: 'm3b', direction: 'inbound', body: 'Received, thank you.', sentAt: '2026-09-21T09:00', isAutomated: false },
      ],
    },
    {
      id: 't4', guestName: 'Chen Yu', subject: 'Late checkout',
      unitNumber: '#2207', propertyName: 'The Establishment', channel: 'agoda',
      isRead: true, lastMessageAt: '2026-09-15T09:32', preview: 'Noted, 13:00 works. Enjoy your stay.',
      messages: [
        { id: 'm4a', direction: 'inbound', body: 'Could we check out at 13:00 instead of 11:00?', sentAt: '2026-09-15T09:30', isAutomated: false },
        { id: 'm4b', direction: 'outbound', body: 'Noted, 13:00 works. Enjoy your stay.', sentAt: '2026-09-15T09:32', isAutomated: false, status: 'sent' },
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
      api.patch(`/messages/threads/${id}`, { isRead: true }).catch(notifyFailure);
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !activeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Show it at once, but explicitly as "sending" — never a sent state yet.
    const optimistic: Message = { id, direction: 'outbound', body, sentAt: now, isAutomated: false, status: 'sending' };
    setSentByThread(s => ({ ...s, [activeId]: [...(s[activeId] ?? []), optimistic] }));
    setDraft('');

    try {
      const res = await api.post<{ delivery: string; reason?: string }>('/messages', { threadId: activeId, body });
      // Only now, after the round-trip resolves, does it read as sent.
      setSentByThread(s => ({
        ...s,
        [activeId]: (s[activeId] ?? []).map(m => (m.id === id ? { ...m, status: 'sent' } : m)),
      }));
      toast(res.delivery === 'sent'
        ? { tone: 'success', title: 'Message sent.' }
        : { tone: 'warning', title: 'Message saved, not delivered yet.', body: res.reason ?? 'WhatsApp is not connected yet, so it is queued.' });
    } catch (e) {
      setSentByThread(s => ({ ...s, [activeId]: (s[activeId] ?? []).filter(m => m.id !== id) }));
      setDraft(body);
      toast({ tone: 'critical', title: 'Message was not sent.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        sub={`${unreadCount} unread · every channel in one thread list`}
      />

      {error && <StaleBanner message={`Showing the last threads we have. ${error}`} onRetry={reload} />}

      <div role="tablist" aria-label="Filter conversations" className="flex gap-[7px] flex-wrap">
        {(['all', 'unread'] as const).map(f => {
          const on = f === filter;
          const label = f === 'all' ? 'All' : `Unread${unreadCount ? ` (${unreadCount})` : ''}`;
          return (
            <button key={f} role="tab" aria-selected={on} onClick={() => setFilter(f)}
              className={cx('h-[34px] flex items-center py-0 px-[15px] rounded-full cursor-pointer whitespace-nowrap [font:inherit] border border-solid',
                on ? 'border-black bg-black text-white' : 'border-line bg-white text-muted-ink')}>
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid [grid-template-columns:minmax(260px,0.8fr)_minmax(0,1.6fr)] gap-5 items-start">
        {/* ---- Thread list, every channel in one place ---- */}
        <Card>
          {loading && threads.length === 0 ? (
            <TableSkeleton rows={4} cols={2} />
          ) : visible.length === 0 ? (
            <div className="py-[28px] px-[22px] flex flex-col gap-3 items-start">
              <span className="text-[13px] text-muted-ink">
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
                  className={cx('flex items-start gap-[11px] w-full py-[13px] px-4 [border-width:0_0_1px] [border-style:solid] [border-color:var(--color-line-soft)] cursor-pointer [font:inherit] text-left',
                    on ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : 'bg-white')}>
                  {t.channel && <ChannelMark ch={t.channel} size={22} />}
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('text-[13.5px] whitespace-nowrap overflow-hidden text-ellipsis', t.isRead ? 'font-medium' : 'font-semibold')}>{t.guestName ?? 'Unknown guest'}</span>
                      <span className="text-[11px] text-muted-ink flex-none">{relative(t.lastMessageAt)}</span>
                    </div>
                    <span className="text-[12px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{t.subject ?? t.preview}</span>
                    <span className="text-[11.5px] text-faint whitespace-nowrap overflow-hidden text-ellipsis">{t.propertyName} {t.unitNumber}</span>
                  </div>
                  {!t.isRead && <span aria-label="Unread" className={cx('w-[7px] h-[7px] flex-none mt-[5px] rounded-full', TONE.critical.dot)} />}
                </button>
              );
            })
          )}
        </Card>

        {/* ---- Selected conversation ---- */}
        <Card>
          {open ? (
            <div className="py-[15px] px-5 [border-bottom:1px_solid_var(--color-line)] flex items-center gap-[11px] flex-wrap">
              {open.channel && <ChannelMark ch={open.channel} size={22} />}
              <div className="flex flex-col gap-px flex-1 min-w-0">
                <span className="text-[14px] font-semibold">{open.guestName ?? 'Unknown guest'}</span>
                <span className="text-[12px] text-muted-ink">{open.propertyName} {open.unitNumber}{open.subject ? ` · ${open.subject}` : ''}</span>
              </div>
              <Badge tone="neutral" label={threadChannelLabel(open.channel)} size="sm" />
            </div>
          ) : (
            <div className="py-[15px] px-5 [border-bottom:1px_solid_var(--color-line)] text-[12px] text-muted-ink">
              No conversation selected
            </div>
          )}

          <div className="p-5 flex flex-col gap-3 min-h-[220px]">
            {loading && messages.length === 0 ? (
              <TableSkeleton rows={2} cols={1} />
            ) : !open ? (
              <span className="text-[13px] text-muted-ink">Select a conversation to read and reply.</span>
            ) : messages.length === 0 ? (
              <span className="text-[13px] text-muted-ink">No messages in this conversation yet.</span>
            ) : (
              messages.map(m => {
                const out = m.direction === 'outbound';
                const sending = m.status === 'sending';
                return (
                  <div key={m.id} className={cx('flex flex-col gap-1', out ? 'items-end' : 'items-start')}>
                    <div className={cx('max-w-[78%] py-[11px] px-[14px] rounded-card text-[13px] leading-[1.55] [text-wrap:pretty]',
                      sending ? 'opacity-70' : 'opacity-100',
                      out ? 'bg-black text-white' : 'bg-muted text-ink')}>
                      {m.body}
                    </div>
                    <div className="flex items-center gap-[7px]">
                      <span className="text-[11px] text-muted-ink">
                        {sending ? 'Sending…' : time(m.sentAt)}
                      </span>
                      {m.isAutomated && <Badge tone="neutral" label="Automated" size="sm" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={send} className="py-[14px] px-5 [border-top:1px_solid_var(--color-line)] flex gap-2.5 items-center">
            <input value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={open ? `Reply to ${open.guestName ?? 'guest'} on ${threadChannelLabel(open.channel)}` : 'Select a conversation'}
              disabled={!open}
              aria-label="Reply"
              className="flex-1 min-w-0 h-10 py-0 px-[14px] [font:inherit] border border-solid border-line rounded-control outline-none" />
            <button type="submit" disabled={!draft.trim() || !open}
              className={cx('h-10 py-0 px-4 rounded-control border-0 [font:inherit]',
                (draft.trim() && open) ? 'bg-black text-white cursor-pointer' : 'bg-muted text-faint cursor-not-allowed')}>
              Send
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
