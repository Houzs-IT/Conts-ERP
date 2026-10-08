import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { color } from '../theme';
import { cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { EmptyState } from '../components/States';
import ChannelMark from '../components/ChannelMark';
import Icon from '../components/Icon';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { rating as fmtRating, date as fmtDate, todayMyt } from '../lib/format';
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
    <span className="flex gap-0.5" role="img" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => <Icon key={i} name="Star" size="sm" color={i <= n ? color.gold : color.border} />)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[3px] px-4 py-[14px]">
      <span className="text-meta text-muted-ink">{label}</span>
      <span className="text-headline font-semibold tabular-nums tracking-[-0.01em]">{value}</span>
    </div>
  );
}

/** Pill toggle, black-on-select — the house filter style (see InboxPage). Gold is
 *  reserved for the stars and never used as a status/selection fill here.
 *  `[font:inherit]` (as in the original inline style) intentionally follows and
 *  neutralises any font-size/weight, so the label inherits the page font. */
function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={cx(
        'h-8 flex items-center gap-[5px] px-[13px] py-0 rounded-full whitespace-nowrap cursor-pointer border border-solid [font:inherit]',
        on ? 'border-black bg-black text-white' : 'border-line bg-card text-muted-ink',
      )}>
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
    const repliedAt = todayMyt();

    try {
      await api.post(`/reviews/${review.id}/reply`, { body });
      setReplies(m => ({ ...m, [review.id]: { reply: body, repliedAt } }));
      setComposingId(null);
      setDraft('');
      toast({ tone: 'success', title: 'Reply saved.', body: 'Kept on the review. Posting it to the channel is not connected yet.' });
      reload();
    } catch (err) {
      toast({ tone: 'critical', title: 'Reply was not saved.', body: err instanceof Error ? err.message : 'Try again in a moment.' });
    }
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
        <div className="grid grid-cols-3">
          <div className="[border-right:1px_solid_var(--color-line-soft)]">
            <Stat label="Average rating" value={average != null ? fmtRating(average, true) : '—'} />
          </div>
          <div className="[border-right:1px_solid_var(--color-line-soft)]">
            <Stat label="Reviews" value={String(total)} />
          </div>
          <Stat label="Replied" value={`${pctReplied}%`} />
        </div>
      </Card>

      {/* Filters */}
      <div className="flex gap-[18px] flex-wrap items-center">
        <div role="group" aria-label="Filter by rating" className="flex gap-[7px] flex-wrap items-center">
          <span className="text-meta font-semibold text-muted-ink">Rating</span>
          <Pill on={ratingFilter === 'all'} onClick={() => setRatingFilter('all')}>All</Pill>
          {([5, 4, 3, 2, 1] as const).map(n => (
            <Pill key={n} on={ratingFilter === n} onClick={() => setRatingFilter(n)}>
              {n}<Icon name="Star" size="sm" color={color.gold} />
            </Pill>
          ))}
        </div>
        <div role="group" aria-label="Filter by reply state" className="flex gap-[7px] flex-wrap items-center">
          <span className="text-meta font-semibold text-muted-ink">Status</span>
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
        filtered
          ? <EmptyState kind="filtered" title="No reviews match these filters." action={{ label: 'Clear filters', onClick: clearFilters }} />
          : <EmptyState icon="Star" title="No reviews yet"
              body="Reviews arrive from Airbnb and Booking.com once units are connected through Channex. Connect a unit from its Channels card, or see Integrations."
              action={{ label: 'Open Integrations', onClick: () => { window.location.hash = '#/system/integrations'; } }} />
      ) : (
        visible.map(r => {
          const replied = r.reply != null;
          const composing = composingId === r.id;
          return (
            <Card key={r.id}>
              <div className="flex flex-col gap-[11px] px-5 py-[15px]">
                <div className="flex items-center justify-between gap-[14px] flex-wrap">
                  <div className="flex items-center gap-[11px] min-w-0">
                    <ChannelMark ch={r.channel} size={22} />
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-copy font-semibold">{r.guestName}</span>
                      <span className="text-meta text-muted-ink">{r.propertyName} {r.unitNumber} · {fmtDate(r.reviewedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Stars n={r.rating} />
                    <Badge tone={replied ? 'success' : 'warning'} label={replied ? 'Replied' : 'Needs reply'} size="sm" />
                  </div>
                </div>

                {r.comment && <p className="m-0 text-copy leading-[1.55] [text-wrap:pretty]">{r.comment}</p>}

                {/* Existing / just-posted reply */}
                {replied && r.reply && (
                  <div className="flex flex-col gap-1 bg-muted rounded-control px-[13px] py-[11px]">
                    <span className="text-caption font-semibold text-muted-ink uppercase tracking-[0.04em]">
                      Your reply{r.repliedAt ? ` · ${fmtDate(r.repliedAt)}` : ''}
                    </span>
                    <p className="m-0 text-copy leading-[1.55] [text-wrap:pretty]">{r.reply}</p>
                  </div>
                )}

                {/* Inline compose */}
                {!replied && !composing && (
                  <Button size="sm" variant="brand" onClick={() => startReply(r.id)} className="self-start">
                    Write a reply
                  </Button>
                )}
                {!replied && composing && (
                  <form onSubmit={e => postReply(e, r)} className="flex flex-col gap-[9px]">
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={3}
                      aria-label={`Reply to ${r.guestName}`}
                      placeholder={`Reply to ${r.guestName} on ${r.propertyName} ${r.unitNumber}`}
                      className="w-full box-border px-3 py-[10px] [font:inherit] text-ink border border-solid border-line rounded-control outline-none resize-y" />
                    <div className="flex gap-[9px] justify-end">
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
