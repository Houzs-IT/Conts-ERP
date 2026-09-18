import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ChannelMark from '../components/ChannelMark';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import type { BookingChannel } from '../lib/types';

interface Thread {
  id: string; guestName: string | null; subject: string | null;
  unitNumber: string | null; propertyName: string | null;
  channel: BookingChannel | null; isRead: boolean; lastMessageAt: string; preview: string | null;
}
interface Message { id: string; direction: 'inbound' | 'outbound'; body: string; sentAt: string; isAutomated: boolean }
interface Payload { threads: Thread[]; messages: Message[]; unread: number; generatedAt: string }

const FALLBACK: Payload = {
  unread: 2, generatedAt: '',
  threads: [
    { id: 't1', guestName: 'Priya Sundaram', subject: 'Early check-in request', unitNumber: '#B-08-11', propertyName: 'Arcoris', channel: 'booking_com', isRead: false, lastMessageAt: '13:45', preview: 'Hi, our flight lands at noon\u2026' },
    { id: 't2', guestName: 'Aaron Lee', subject: 'Parking access', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'direct', isRead: false, lastMessageAt: '11:20', preview: 'Is there a parking bay included?' },
    { id: 't3', guestName: 'Nadia Abdullah', subject: 'Check-in details', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', isRead: true, lastMessageAt: 'Yesterday', preview: 'Received, thank you.' },
  ],
  messages: [
    { id: 'm1', direction: 'inbound', body: 'Hi, our flight lands at noon. Would 14:00 check-in be possible?', sentAt: '13:45', isAutomated: false },
  ],
};

export default function InboxPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();

  const list = useApi<Payload>('/messages', FALLBACK);
  const threads = list.data?.threads ?? [];
  const activeId = openId ?? threads[0]?.id ?? null;
  const thread = useApi<Payload>(activeId ? `/messages?threadId=${activeId}` : '/messages', FALLBACK);

  const open = threads.find(t => t.id === activeId);
  const messages = thread.data?.messages ?? [];

  async function send() {
    if (!draft.trim() || !activeId || sending) return;
    setSending(true);
    try {
      await api.post('/messages', { threadId: activeId, body: draft });
      setDraft('');
      thread.reload();
      list.reload();
    } catch (e) {
      // Never a sent state before the server confirms.
      toast({ tone: 'critical', title: 'Message not sent.', body: e instanceof ApiFailure ? e.message : 'Check your connection and try again.' });
    } finally { setSending(false); }
  }

  return (
    <>
      <PageHeader title="Inbox" sub={`${list.data?.unread ?? 0} unread &middot; every channel in one thread list`} />

      {list.error && <StaleBanner message={`Showing the last threads we have. ${list.error}`} onRetry={list.reload} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,0.8fr) minmax(0,1.6fr)', gap: 20, alignItems: 'start' }}>
        <Card>
          {list.loading && threads.length === 0 ? <TableSkeleton rows={3} cols={2} /> : threads.map(t => {
            const on = t.id === activeId;
            return (
              <button key={t.id} onClick={() => setOpenId(t.id)}
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
                {!t.isRead && <span style={{ width: 7, height: 7, flex: 'none', marginTop: 5, borderRadius: 999, background: '#C2413B' }} />}
              </button>
            );
          })}
        </Card>

        <Card>
          {open && (
            <div style={{ padding: '15px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
              {open.channel && <ChannelMark ch={open.channel} size={22} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{open.guestName ?? 'Unknown guest'}</span>
                <span style={{ fontSize: text.small, color: color.textMuted }}>{open.propertyName} {open.unitNumber}{open.subject ? ` · ${open.subject}` : ''}</span>
              </div>
            </div>
          )}

          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 220 }}>
            {thread.loading && messages.length === 0 ? <TableSkeleton rows={2} cols={1} /> : messages.map(m => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: m.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '78%', padding: '11px 14px', borderRadius: radius.card, fontSize: 13, lineHeight: 1.55, textWrap: 'pretty',
                  background: m.direction === 'outbound' ? color.black : color.muted, color: m.direction === 'outbound' ? '#FFFFFF' : color.ink }}>
                  {m.body}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: text.micro, color: color.textMuted }}>{m.sentAt}</span>
                  {m.isAutomated && <Badge tone="neutral" label="Automated" />}
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 20px', borderTop: `1px solid ${color.border}`, display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void send(); }}
              placeholder={open ? `Reply to ${open.guestName ?? 'guest'}` : 'Select a conversation'}
              disabled={!open || sending}
              style={{ flex: 1, minWidth: 0, height: 40, padding: '0 14px', fontSize: 13, font: 'inherit', border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none' }} />
            <button onClick={send} disabled={!draft.trim() || sending}
              style={{ height: 40, padding: '0 16px', borderRadius: radius.control, background: draft.trim() ? color.black : color.muted, color: draft.trim() ? '#FFFFFF' : color.faint, fontSize: 13, fontWeight: 500, border: 'none', cursor: draft.trim() ? 'pointer' : 'not-allowed' }}>
              {sending ? 'Sending\u2026' : 'Send'}
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
