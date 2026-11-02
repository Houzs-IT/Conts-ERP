import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { cx, TONE } from '../lib/design-tokens';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { EmptyState } from '../components/States';
import ChannelMark, { channelLabel } from '../components/ChannelMark';
import { StatusBadge } from '../components/StatusBadge';
import { Segmented } from '../components/Metric';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, errorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import { relative, time, date as fmtDate, dateRange, count, guests as fmtGuests } from '../lib/format';
import { Button } from '../components/Button';
import { deliveryToast } from '../lib/bookingStatus';
import { refreshNavCounts } from '../lib/navBadges';
import { useSession } from '../lib/session';
import { mayWork } from '../lib/areaAccess';
import type { BookingChannel } from '../lib/types';
import { useUrlState, SearchBox, FilterSelect, BusyBar, usePhone } from './finance/listKit';
import { SavedRepliesMenu, SavedRepliesManager, useSavedReplies } from './inbox/SavedReplies';

type Delivery = 'sent' | 'failed' | 'queued' | 'not_linked' | null;
/** One message. `delivery` is only on replies sent from here (migration 0104); `sending` only on screen. */
interface Message {
  id: string; direction: 'inbound' | 'outbound'; body: string; sentAt: string; isAutomated: boolean; senderName: string | null;
  delivery: Delivery | 'sending'; deliveryReason: string | null; attachments: { url: string; name: string }[];
}
interface ThreadHead {
  id: string; channel: BookingChannel | null; subject: string | null; isRead: boolean; lastMessageAt: string;
  guestName: string | null; unitId: string | null; unitNumber: string | null; propertyName: string | null;
  reservationId: string | null; checkIn: string | null; checkOut: string | null; reservationState: string | null;
  bookingRef: string | null; guestsCount: number | null; inquiry: boolean; linked: boolean;
}
interface ThreadRow extends ThreadHead { preview: string | null; lastDirection: 'inbound' | 'outbound' | null; lastDelivery: Delivery }
interface ListPage { threads: ThreadRow[]; nextCursor: string | null; totals: { all: number; unread: number; inquiries: number }; units: { id: string; label: string }[]; channexConnected: boolean }
interface ThreadFull extends ThreadHead { messages: Message[] }

/** Direct guests are reached on WhatsApp; every other channel keeps its own name. */
const where = (ch: BookingChannel | null) => (ch === null || ch === 'direct' ? 'WhatsApp' : channelLabel(ch));
const CHANNELS = [{ value: 'airbnb', label: 'Airbnb' }, { value: 'booking_com', label: 'Booking.com' }, { value: 'agoda', label: 'Agoda' }, { value: 'direct', label: 'Direct (WhatsApp)' }];
type View = 'all' | 'unread' | 'inquiry';
const IMAGE = /\.(png|jpe?g|gif|webp|heic)(\?|$)|placehold\.co/i;

function unitLine(t: ThreadHead) {
  const unit = [t.propertyName, t.unitNumber].filter(Boolean).join(' ');
  const stay = t.checkIn && t.checkOut ? dateRange(t.checkIn, t.checkOut) : null;
  return [unit || null, stay ?? (t.inquiry ? 'Inquiry, no reservation yet' : null)].filter(Boolean).join(' · ');
}

/** Messages: every guest conversation from Airbnb, Booking.com, Agoda and WhatsApp in one list, newest first, loaded 40
 *  at a time as the list is scrolled. Search, the views (All, Unread, Inquiries) and the channel and unit filters live
 *  in the address. On a phone the list and the open conversation take the screen in turn. */
export default function InboxPage() {
  const url = useUrlState();
  const toast = useToast();
  const phone = usePhone();
  const { user } = useSession();
  const canSend = mayWork(user, 'comms');
  const f = { q: url.get('q'), channel: url.get('channel'), unitId: url.get('unitId') };
  const view = (['unread', 'inquiry'].includes(url.get('view')) ? url.get('view') : 'all') as View;
  const openId = url.get('thread') || null;
  const key = JSON.stringify({ ...f, view });

  /* ---- the list, a page at a time ---- */
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  const [meta, setMeta] = useState<Omit<ListPage, 'threads'> | null>(null);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const live = useRef(key);
  async function loadList(cursor: string | null) {
    const at = key;
    setBusy(true);
    try {
      const res = await api.get<ListPage>('/messages/threads', { ...f, unread: view === 'unread' ? '1' : '', kind: view === 'inquiry' ? 'inquiry' : '', cursor: cursor ?? '' });
      if (live.current !== at) return;
      setRows(prev => (cursor ? [...(prev ?? []), ...res.threads] : res.threads));
      setMeta({ nextCursor: res.nextCursor, totals: res.totals, units: res.units, channexConnected: res.channexConnected });
      setListError(null);
    } catch (e) {
      if (live.current === at) setListError(errorMessage(e, 'Messages could not be loaded.'));
    } finally { if (live.current === at) setBusy(false); }
  }
  useEffect(() => { live.current = key; void loadList(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || !meta?.nextCursor) return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !busy) void loadList(meta.nextCursor); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop opens the newest conversation by itself; a phone starts on the list.
  const activeId = openId ?? (phone ? null : rows?.[0]?.id ?? null);
  const detail = useApi<ThreadFull>(activeId ? `/messages/threads/${activeId}` : null);
  const open = detail.data && detail.data.id === activeId ? detail.data : null;

  function patchRow(id: string, p: Partial<ThreadRow>) { setRows(rs => rs?.map(r => (r.id === id ? { ...r, ...p } : r)) ?? rs); }
  function select(id: string) {
    url.set({ thread: id });
    const row = rows?.find(r => r.id === id);
    if (row && !row.isRead) {
      patchRow(id, { isRead: true });
      setMeta(m => (m ? { ...m, totals: { ...m.totals, unread: Math.max(0, m.totals.unread - 1) } } : m));
      api.patch(`/messages/threads/${id}`, { isRead: true }).then(() => refreshNavCounts()).catch(notifyFailure);
    }
  }
  async function markUnread() {
    if (!open) return;
    patchRow(open.id, { isRead: false });
    setMeta(m => (m ? { ...m, totals: { ...m.totals, unread: m.totals.unread + 1 } } : m));
    await api.patch(`/messages/threads/${open.id}`, { isRead: false }).then(() => refreshNavCounts()).catch(notifyFailure);
    url.set({ thread: null });
  }
  // A conversation opened from a link (Reviews, a reservation) is read once it shows.
  useEffect(() => {
    if (open && !open.isRead && rows?.find(r => r.id === open.id)?.isRead !== true) {
      patchRow(open.id, { isRead: true });
      api.patch(`/messages/threads/${open.id}`, { isRead: true }).then(() => refreshNavCounts()).catch(() => {});
    }
  }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- replying ---- */
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Record<string, Message[]>>({});
  const [retrying, setRetrying] = useState<string | null>(null);
  const saved = useSavedReplies();
  const [managing, setManaging] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(''); }, [activeId]);

  const messages: Message[] = open ? [...open.messages, ...(pending[open.id] ?? []).filter(p => !open.messages.some(m => m.id === p.id))] : [];

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !open) return;
    const tmp = `local-${Date.now()}`;
    const optimistic: Message = { id: tmp, direction: 'outbound', body, sentAt: new Date().toISOString(), isAutomated: false, senderName: user?.fullName ?? null, delivery: 'sending', deliveryReason: null, attachments: [] };
    setPending(s => ({ ...s, [open.id]: [...(s[open.id] ?? []), optimistic] }));
    setDraft('');
    try {
      const res = await api.post<{ id: string; delivery: Delivery; reason?: string; sentAt: string }>('/messages', { threadId: open.id, body });
      setPending(s => ({ ...s, [open.id]: (s[open.id] ?? []).map(m => (m.id === tmp ? { ...m, id: res.id, delivery: res.delivery, deliveryReason: res.reason ?? null } : m)) }));
      patchRow(open.id, { preview: body, lastDirection: 'outbound', lastDelivery: res.delivery, lastMessageAt: res.sentAt, isRead: true });
      toast(deliveryToast(res.delivery ?? undefined, open.guestName || 'the guest', res.reason));
      detail.reload();
    } catch (err) {
      setPending(s => ({ ...s, [open.id]: (s[open.id] ?? []).filter(m => m.id !== tmp) }));
      setDraft(body);
      toast({ tone: 'critical', title: 'Message was not sent.', body: errorMessage(err, 'Try again in a moment.') });
    }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl or Cmd + Enter sends; Enter alone starts a new line, as guests write in paragraphs.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
  }
  async function retry(m: Message) {
    if (!open) return;
    setRetrying(m.id);
    try {
      const res = await api.post<{ delivery: Delivery; reason: string | null }>(`/messages/${m.id}/retry`);
      toast(deliveryToast(res.delivery ?? undefined, open.guestName || 'the guest', res.reason ?? undefined));
      setPending(s => ({ ...s, [open.id]: (s[open.id] ?? []).map(x => (x.id === m.id ? { ...x, delivery: res.delivery, deliveryReason: res.reason } : x)) }));
      detail.reload();
    } catch (err) {
      toast({ tone: 'critical', title: 'Not sent again.', body: errorMessage(err) });
    } finally { setRetrying(null); }
  }
  function insert(text: string) {
    setDraft(d => (d.trim() ? `${d.trimEnd()}\n\n${text}` : text));
    requestAnimationFrame(() => box.current?.focus());
  }

  const totals = meta?.totals;
  const filtered = !!(f.q || f.channel || f.unitId) || view !== 'all';
  const showList = !phone || !activeId;
  const showThread = !phone || !!activeId;

  return (
    <>
      <PageHeader title="Messages"
        sub={totals ? `${count(totals.unread)} unread · ${count(totals.all)} conversations from Airbnb, Booking.com, Agoda and WhatsApp` : 'Airbnb, Booking.com, Agoda and WhatsApp messages together'} />

      {showList && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented label="Show" value={view} onChange={k => url.set({ view: k === 'all' ? null : k, thread: null })}
              options={[
                { key: 'all', label: 'All' },
                { key: 'unread', label: 'Unread', count: totals?.unread || undefined, tone: totals?.unread ? 'danger' : undefined },
                { key: 'inquiry', label: 'Inquiries', count: totals?.inquiries || undefined },
              ]} />
          </div>
          <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2">
            <SearchBox className="col-span-2 md:flex-[2_1_260px]" label="Search messages" placeholder="Search guest, unit or words in a message" value={f.q} onChange={v => url.set({ q: v || null, thread: null })} />
            <FilterSelect className="md:flex-[1_1_170px]" label="Channel" all="All channels" value={f.channel} onChange={v => url.set({ channel: v || null, thread: null })} options={CHANNELS} />
            <FilterSelect className="md:flex-[1_1_200px]" label="Unit" all="All units" value={f.unitId} onChange={v => url.set({ unitId: v || null, thread: null })}
              options={(meta?.units ?? []).map(u => ({ value: u.id, label: u.label }))} />
          </div>
        </div>
      )}

      {listError && <StaleBanner message={`Showing the last messages we have. ${listError}`} onRetry={() => loadList(null)} />}

      <div className="grid grid-cols-1 md:[grid-template-columns:minmax(280px,0.85fr)_minmax(0,1.6fr)] gap-4 md:gap-5 items-start">
        {/* ---- conversations ---- */}
        {showList && (
          <Card className="relative">
            <BusyBar on={busy} />
            {rows === null ? (
              <TableSkeleton rows={5} cols={2} />
            ) : rows.length === 0 ? (
              filtered
                ? <EmptyState bare kind="filtered" title="No conversations match." action={{ label: 'Show all', onClick: () => url.set({ q: null, channel: null, unitId: null, view: null }) }} />
                : <EmptyState bare icon="MessageCircle" title="No messages yet"
                    body={meta?.channexConnected
                      ? 'Guest messages arrive here from Airbnb and Booking.com through Channex, and from WhatsApp for direct reservations.'
                      : 'Messages from Airbnb and Booking.com arrive through Channex, which is not connected on this system. WhatsApp replies to direct guests still work.'} />
            ) : (
              <div className="md:max-h-[calc(100vh-260px)] md:overflow-y-auto">
                {rows.map(t => {
                  const on = t.id === activeId;
                  return (
                    <button key={t.id} onClick={() => select(t.id)} aria-current={on}
                      className={cx('flex items-start gap-3 w-full min-h-[56px] py-3 px-4 sm:px-5 [border-width:0_0_1px] [border-style:solid] [border-color:var(--color-line-soft)] cursor-pointer [font:inherit] text-left',
                        on ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : 'bg-card hover:bg-muted')}>
                      {t.channel ? <ChannelMark ch={t.channel} size={24} /> : <span className="w-6" />}
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cx('text-copy truncate', t.isRead ? 'font-medium' : 'font-semibold')}>{t.guestName ?? 'Unknown guest'}</span>
                          <span className={cx('text-caption flex-none', t.isRead ? 'text-muted-ink' : 'text-ink font-semibold')}>{relative(t.lastMessageAt)}</span>
                        </div>
                        <span className="text-meta text-muted-ink truncate">{unitLine(t) || where(t.channel)}</span>
                        <span className={cx('text-meta truncate flex items-center gap-1', t.isRead ? 'text-faint' : 'text-ink-2')}>
                          {t.lastDirection === 'outbound' && (t.lastDelivery === 'failed' || t.lastDelivery === 'not_linked')
                            ? <span className={cx('flex-none', TONE.critical.text)}><Icon name="CircleAlert" size="sm" /></span> : null}
                          <span className="truncate">{t.lastDirection === 'outbound' ? 'You: ' : ''}{t.preview ?? ''}</span>
                        </span>
                        {t.inquiry && <span className="mt-0.5"><StatusBadge tone="info" label="Inquiry" size="sm" /></span>}
                      </div>
                      {!t.isRead && <span aria-label="Unread" className={cx('w-2 h-2 flex-none mt-[6px] rounded-full', TONE.critical.dot)} />}
                    </button>
                  );
                })}
                <div ref={end} />
                {meta?.nextCursor && (
                  <div className="p-3 flex justify-center"><Button size="sm" variant="secondary" loading={busy} onClick={() => loadList(meta.nextCursor)}>Show more</Button></div>
                )}
              </div>
            )}
          </Card>
        )}

        {/* ---- the open conversation ---- */}
        {showThread && (
          <Card>
            {!activeId ? (
              <div className="p-6 text-copy text-muted-ink">{rows?.length ? 'Select a conversation to read and reply.' : 'No conversation selected.'}</div>
            ) : !open ? (
              detail.error
                ? <div className="p-5"><StaleBanner message={detail.error} onRetry={detail.reload} /></div>
                : <div className="p-5"><TableSkeleton rows={3} cols={1} /></div>
            ) : (
              <>
                <div className="py-3.5 px-4 sm:px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-start gap-3 flex-wrap">
                  {phone && (
                    <button type="button" onClick={() => url.set({ thread: null })} aria-label="Back to conversations"
                      className="h-9 w-9 -ml-2 grid place-items-center bg-transparent border-none cursor-pointer text-ink"><Icon name="ChevronLeft" /></button>
                  )}
                  {open.channel && <ChannelMark ch={open.channel} size={26} />}
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-[16px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">{open.guestName ?? 'Unknown guest'}</span>
                    <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">
                      {[open.propertyName, open.unitNumber].filter(Boolean).join(' ') || 'Unit not known'}
                      {open.checkIn && open.checkOut ? ` · ${dateRange(open.checkIn, open.checkOut)}` : ''}
                      {open.guestsCount ? ` · ${fmtGuests(open.guestsCount)}` : ''}
                    </span>
                    <span className="flex items-center gap-2 flex-wrap mt-1">
                      <StatusBadge tone="neutral" label={where(open.channel)} size="sm" />
                      {open.inquiry ? <StatusBadge tone="info" label="Inquiry, no reservation yet" size="sm" />
                        : open.reservationId && <Link to={`/reservations/bookings?open=${encodeURIComponent(open.reservationId)}`} className="text-meta text-ink-2">Reservation{open.bookingRef ? ` ${open.bookingRef}` : ''}</Link>}
                    </span>
                  </div>
                  <Button size="sm" variant="tertiary" onClick={markUnread}>Mark unread</Button>
                </div>

                <div className="p-4 sm:p-5 flex flex-col gap-3 min-h-[240px] md:max-h-[calc(100vh-420px)] md:overflow-y-auto" aria-live="polite">
                  {messages.length === 0 ? (
                    <span className="text-copy text-muted-ink">No messages with this guest yet.</span>
                  ) : messages.map((m, i) => {
                    const out = m.direction === 'outbound';
                    const day = fmtDate(m.sentAt);
                    const newDay = i === 0 || fmtDate(messages[i - 1].sentAt) !== day;
                    const notDelivered = out && (m.delivery === 'failed' || m.delivery === 'not_linked');
                    return (
                      <div key={m.id} className="flex flex-col gap-1">
                        {newDay && <span className="self-center text-caption text-muted-ink py-1">{day}</span>}
                        <div className={cx('flex flex-col gap-1', out ? 'items-end' : 'items-start')}>
                          <div className={cx('max-w-[85%] sm:max-w-[78%] py-2.5 px-3.5 rounded-card text-copy leading-[1.55] [text-wrap:pretty] whitespace-pre-line [overflow-wrap:anywhere]',
                            m.delivery === 'sending' && 'opacity-70', out ? 'bg-black text-white' : 'bg-muted text-ink', notDelivered && '[outline:2px_solid_var(--color-danger-line)]')}>
                            {m.body}
                            {m.attachments.length > 0 && (
                              <div className="flex flex-col gap-2 mt-2">
                                {m.attachments.map(a => IMAGE.test(a.url)
                                  ? <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener"><img src={a.url} alt={a.name} loading="lazy" className="block max-w-full max-h-[220px] rounded-control" /></a>
                                  : <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener" className={cx('inline-flex items-center gap-1.5 text-meta', out ? 'text-white' : 'text-ink-2')}><Icon name="Paperclip" size="sm" />{a.name}</a>)}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            <span className="text-caption text-muted-ink">
                              {m.delivery === 'sending' ? 'Sending…' : `${out && m.senderName ? `${m.senderName} · ` : ''}${time(m.sentAt)}`}
                            </span>
                            {m.isAutomated && <StatusBadge tone="neutral" label="Automatic" size="sm" />}
                            {out && m.delivery === 'sent' && <span className="text-caption text-muted-ink inline-flex items-center gap-0.5"><Icon name="Check" size="sm" />Delivered</span>}
                            {out && m.delivery === 'queued' && <StatusBadge tone="info" label="Waiting to send" size="sm" />}
                            {out && m.delivery === 'failed' && <StatusBadge tone="critical" label="Not delivered" size="sm" />}
                            {out && m.delivery === 'not_linked' && <StatusBadge tone="warning" label="Saved here only" size="sm" />}
                          </div>
                          {notDelivered && (
                            <div className="flex items-center gap-2 flex-wrap justify-end max-w-[85%]">
                              {m.deliveryReason && <span className="text-caption text-muted-ink text-right">{m.deliveryReason}</span>}
                              {canSend && <Button size="sm" variant="secondary" loading={retrying === m.id} onClick={() => retry(m)}>Retry</Button>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {canSend ? (
                  <form onSubmit={send} className="py-3 px-4 sm:px-5 [border-top:1px_solid_var(--color-line)] flex flex-col gap-2">
                    {!open.linked && (
                      <span className="text-meta text-muted-ink flex items-start gap-1.5">
                        <Icon name="CircleHelp" size="sm" />
                        {open.channel === 'direct' ? 'This guest has no phone number on file, so replies are kept here only.' : `This conversation is not linked to ${where(open.channel)}, so replies are kept here only.`}
                      </span>
                    )}
                    <textarea ref={box} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} rows={phone ? 3 : 3} maxLength={2000}
                      placeholder={`Reply to ${open.guestName ?? 'the guest'} on ${where(open.channel)}`} aria-label="Reply"
                      className="w-full box-border px-3.5 py-2.5 [font-family:inherit] text-copy bg-card text-ink border border-solid border-line rounded-control outline-none resize-y min-h-[72px]" />
                    <div className="flex items-center gap-2 justify-between flex-wrap">
                      <SavedRepliesMenu replies={saved.data?.data ?? []} onInsert={insert} onManage={() => setManaging(true)} canEdit={canSend} />
                      <div className="flex items-center gap-3">
                        {!phone && <span className="text-caption text-muted-ink">Ctrl + Enter to send</span>}
                        <Button type="submit" variant="primary" size="md" disabled={!draft.trim()} disabledReason="Write a message first.">Send</Button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className="py-3 px-5 [border-top:1px_solid_var(--color-line)] text-meta text-muted-ink">You can read messages but not reply.</div>
                )}
              </>
            )}
          </Card>
        )}
      </div>
      {managing && <SavedRepliesManager replies={saved.data?.data ?? []} onClose={() => setManaging(false)} onChanged={saved.reload} />}
    </>
  );
}
