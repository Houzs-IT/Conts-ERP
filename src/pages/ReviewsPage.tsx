import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ChannelMark from '../components/ChannelMark';
import Icon from '../components/Icon';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { rating as fmtRating, date as fmtDate } from '../lib/format';
import type { BookingChannel } from '../lib/types';

/** A guest review pulled in from a channel. `reply`/`repliedAt` are set once the
 *  host has responded; a null `reply` is the "needs reply" state. */
interface Review {
  id: string; guestName: string; unitNumber: string; propertyName: string;
  channel: BookingChannel; rating: number; comment: string | null; reviewedAt: string;
  reply: string | null; repliedAt: string | null;
}
interface Payload { data: Review[]; average: number | null; generatedAt: string }

const FALLBACK: Payload = {
  average: 4.6, generatedAt: '',
  data: [
    { id: 'r1', guestName: 'Nadia A.', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', rating: 5, comment: 'Spotless and exactly as described. Check-in instructions were clear.', reviewedAt: '2026-09-14', reply: null, repliedAt: null },
    { id: 'r2', guestName: 'Jonathan T.', unitNumber: '#B-08-11', propertyName: 'Arcoris', channel: 'airbnb', rating: 5, comment: 'Great location, quick responses from the host.', reviewedAt: '2026-09-12', reply: 'Thank you Jonathan — glad the stay went smoothly. You are welcome back any time.', repliedAt: '2026-09-12' },
    { id: 'r3', guestName: 'Marcus W.', unitNumber: '#2207', propertyName: 'Tribeca', channel: 'booking_com', rating: 5, comment: 'Best value in Bukit Bintang. Would stay again.', reviewedAt: '2026-09-10', reply: null, repliedAt: null },
    { id: 'r4', guestName: 'Chen Y.', unitNumber: '#15-06', propertyName: 'Scarletz', channel: 'agoda', rating: 4, comment: 'Comfortable, but the aircon was a little loud at night.', reviewedAt: '2026-09-05', reply: null, repliedAt: null },
    { id: 'r5', guestName: 'Priya S.', unitNumber: '#12-08', propertyName: 'Scarletz', channel: 'booking_com', rating: 3, comment: 'Nice unit but the kitchen was missing some basics. Otherwise fine.', reviewedAt: '2026-08-30', reply: 'Thanks for flagging this, Priya. We have restocked the kitchen inventory for the unit.', repliedAt: '2026-08-31' },
    { id: 'r6', guestName: 'Daniel O.', unitNumber: '#A-05-01', propertyName: 'Vista Jaya One', channel: 'agoda', rating: 2, comment: 'Check-in took a while and the WiFi kept dropping during my stay.', reviewedAt: '2026-08-22', reply: null, repliedAt: null },
  ],
};

type ReplyState = 'all' | 'needs_reply' | 'replied';
type RatingFilter = 'all' | 5 | 4 | 3 | 2 | 1;

function Stars({ n }: { n: number }) {
  return (
    <span style={{ display: 'flex', gap: 2 }} role="img" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => <Icon key={i} name="Star" size="sm" color={i <= n ? color.gold : color.border} />)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px' }}>
      <span style={{ fontSize: text.small, color: color.textMuted }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{value}</span>
    </div>
  );
}

/** Pill toggle, black-on-select — the house filter style (see InboxPage). Gold is
 *  reserved for the stars and never used as a status/selection fill here. */
function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      style={{ height: 32, display: 'flex', alignItems: 'center', gap: 5, padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
        border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : color.card, color: on ? '#FFFFFF' : color.textMuted }}>
      {children}
    </button>
  );
}

export default function ReviewsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/reviews', FALLBACK);
  const toast = useToast();

  // Optimistic overlay — there is no backend in dev. A local reply marks the
  // review "replied" the moment it is posted, before any round-trip resolves.
  const [replies, setReplies] = useState<Record<string, { reply: string; repliedAt: string }>>({});
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [replyFilter, setReplyFilter] = useState<ReplyState>('all');
  const [composingId, setComposingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rows = useMemo<Review[]>(() => {
    const base = data?.data ?? [];
    return base.map(r => {
      const local = replies[r.id];
      return local ? { ...r, reply: local.reply, repliedAt: local.repliedAt } : r;
    });
  }, [data, replies]);

  // Summary is over the whole set, not the filtered view.
  const total = rows.length;
  const repliedCount = rows.filter(r => r.reply != null).length;
  const needsReplyCount = total - repliedCount;
  const average = total > 0 ? rows.reduce((s, r) => s + r.rating, 0) / total : (data?.average ?? null);
  const pctReplied = total > 0 ? Math.round((repliedCount / total) * 100) : 0;

  const visible = rows.filter(r => {
    if (ratingFilter !== 'all' && r.rating !== ratingFilter) return false;
    if (replyFilter === 'replied' && r.reply == null) return false;
    if (replyFilter === 'needs_reply' && r.reply != null) return false;
    return true;
  });

  const filtered = ratingFilter !== 'all' || replyFilter !== 'all';
  function clearFilters() { setRatingFilter('all'); setReplyFilter('all'); }

  function startReply(id: string) { setComposingId(id); setDraft(''); }
  function cancelReply() { setComposingId(null); setDraft(''); }

  async function postReply(e: FormEvent, review: Review) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const repliedAt = new Date().toISOString();

    setReplies(m => ({ ...m, [review.id]: { reply: body, repliedAt } }));  // show at once
    setComposingId(null);
    setDraft('');
    toast({ tone: 'success', title: 'Reply posted.', body: `Sent to ${review.guestName}.` });

    try { await api.post(`/reviews/${review.id}/reply`, { body }); }
    catch { /* dev: no backend, keep the optimistic reply */ }
  }

  return (
    <>
      <PageHeader
        title="Reviews"
        sub={total > 0
          ? `${fmtRating(average ?? 0)} average across ${total} reviews · ${pctReplied}% replied`
          : 'Guest reviews across every channel'}
      />

      {error && <StaleBanner message={`Showing the last reviews we have. ${error}`} onRetry={reload} />}

      {/* Summary header */}
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div style={{ borderRight: `1px solid ${color.borderMuted}` }}>
            <Stat label="Average rating" value={average != null ? fmtRating(average, true) : '—'} />
          </div>
          <div style={{ borderRight: `1px solid ${color.borderMuted}` }}>
            <Stat label="Reviews" value={String(total)} />
          </div>
          <Stat label="Replied" value={`${pctReplied}%`} />
        </div>
      </Card>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="group" aria-label="Filter by rating" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: text.small, fontWeight: 600, color: color.textMuted }}>Rating</span>
          <Pill on={ratingFilter === 'all'} onClick={() => setRatingFilter('all')}>All</Pill>
          {([5, 4, 3, 2, 1] as const).map(n => (
            <Pill key={n} on={ratingFilter === n} onClick={() => setRatingFilter(n)}>
              {n}<Icon name="Star" size="sm" color={color.gold} />
            </Pill>
          ))}
        </div>
        <div role="group" aria-label="Filter by reply state" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: text.small, fontWeight: 600, color: color.textMuted }}>Status</span>
          <Pill on={replyFilter === 'all'} onClick={() => setReplyFilter('all')}>All</Pill>
          <Pill on={replyFilter === 'needs_reply'} onClick={() => setReplyFilter('needs_reply')}>
            Needs reply{needsReplyCount ? ` (${needsReplyCount})` : ''}
          </Pill>
          <Pill on={replyFilter === 'replied'} onClick={() => setReplyFilter('replied')}>Replied</Pill>
        </div>
      </div>

      {/* List */}
      {loading && rows.length === 0 ? (
        <Card><TableSkeleton rows={4} cols={3} /></Card>
      ) : visible.length === 0 ? (
        <Card>
          <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 13, color: color.textMuted }}>
              {filtered ? 'No reviews match these filters.' : 'No reviews yet.'}
            </span>
            {filtered && <Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
          </div>
        </Card>
      ) : (
        visible.map(r => {
          const replied = r.reply != null;
          const composing = composingId === r.id;
          return (
            <Card key={r.id}>
              <div style={{ padding: '15px 20px', display: 'flex', flexDirection: 'column', gap: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <ChannelMark ch={r.channel} size={22} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.guestName}</span>
                      <span style={{ fontSize: 11.5, color: color.textMuted }}>{r.propertyName} {r.unitNumber} · {fmtDate(r.reviewedAt)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Stars n={r.rating} />
                    <Badge tone={replied ? 'success' : 'warning'} label={replied ? 'Replied' : 'Needs reply'} size="sm" />
                  </div>
                </div>

                {r.comment && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, textWrap: 'pretty' }}>{r.comment}</p>}

                {/* Existing / just-posted reply */}
                {replied && r.reply && (
                  <div style={{ padding: '11px 13px', background: color.muted, borderRadius: radius.control, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: color.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Your reply{r.repliedAt ? ` · ${fmtDate(r.repliedAt)}` : ''}
                    </span>
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, textWrap: 'pretty' }}>{r.reply}</p>
                  </div>
                )}

                {/* Inline compose */}
                {!replied && !composing && (
                  <Button size="sm" variant="brand" onClick={() => startReply(r.id)} style={{ alignSelf: 'flex-start' }}>
                    Write a reply
                  </Button>
                )}
                {!replied && composing && (
                  <form onSubmit={e => postReply(e, r)} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={3}
                      aria-label={`Reply to ${r.guestName}`}
                      placeholder={`Reply to ${r.guestName} on ${r.propertyName} ${r.unitNumber}`}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 13, lineHeight: 1.5, font: 'inherit', color: color.ink, border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
                      <Button type="button" size="sm" variant="secondary" onClick={cancelReply}>Cancel</Button>
                      <Button type="submit" size="sm" variant="primary" disabled={!draft.trim()} disabledReason="Write a reply first.">
                        Post reply
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </Card>
          );
        })
      )}
    </>
  );
}
