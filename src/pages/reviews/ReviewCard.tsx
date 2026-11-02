import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ChannelMark, { channelLabel } from '../../components/ChannelMark';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { date as fmtDate, dateRange, todayMyt } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { isBadReview } from '../../lib/reviewRules';
import type { BookingChannel } from '../../lib/types';

/** A guest review as /api/reviews and the reservation detail send it (functions/_lib/reviews.ts reviewOut). */
export interface Review {
  id: string; channel: BookingChannel; rating: number; comment: string | null; reviewedAt: string;
  guestName: string; unitId: string | null; unitNumber: string | null; propertyId: string | null; propertyName: string | null;
  reservationId: string | null; checkIn: string | null; checkOut: string | null; bookingRef: string | null;
  reply: string | null; repliedAt: string | null; channelReply: string | null;
  scores: { category: string; score: number }[];
  linked: boolean;
  replyPost: { state: 'sent' | 'failed'; reason: string | null } | null;
}

export function Stars({ n, size = 'sm' }: { n: number; size?: 'sm' | 'base' }) {
  const whole = Math.round(n);
  return (
    <span className={cx('inline-flex gap-px leading-none', size === 'sm' ? 'text-[15px]' : 'text-[19px]')} role="img" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => <span key={i} aria-hidden className={i <= whole ? 'text-gold' : 'text-line'}>★</span>)}
    </span>
  );
}

const channelName = (ch: BookingChannel) => channelLabel(ch);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Category scores out of 10 (Booking.com): a short bar each, red at 6 and under. */
function Scores({ scores }: { scores: Review['scores'] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-2">
      {scores.map(s => (
        <div key={s.category} className="flex flex-col gap-1 min-w-0">
          <div className="flex justify-between gap-2 text-meta">
            <span className="text-muted-ink truncate">{capital(s.category)}</span>
            <span className="tabular-nums font-medium">{Number.isInteger(s.score) ? s.score : s.score.toFixed(1)}</span>
          </div>
          <span className="h-1.5 rounded-full bg-muted overflow-hidden">
            <span className={cx('block h-full rounded-full', s.score <= 6 ? 'bg-danger-line' : 'bg-gold')} style={{ width: `${Math.max(0, Math.min(10, s.score)) * 10}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** One review: who, which unit and reservation, the stars and text, sub-scores, and the reply. Replying happens on
 *  the card; a reply that did not reach the channel says so with a Retry. `compact` is the reservation drawer's
 *  version: no unit line (the drawer is already about that reservation). */
export function ReviewCard({ review, canReply, onChanged, compact }: {
  review: Review; canReply: boolean; onChanged?: () => void; compact?: boolean;
}) {
  const toast = useToast();
  const [local, setLocal] = useState<Pick<Review, 'reply' | 'repliedAt' | 'replyPost'> | null>(null);
  const r = local ? { ...review, ...local } : review;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const replied = r.reply != null;
  const bad = isBadReview(r.rating);
  const failed = r.replyPost?.state === 'failed';

  async function post(body: string, retry = false) {
    setBusy(true);
    try {
      const res = await api.post<{ post: { state: 'sent' | 'failed'; reason?: string | null } | null }>(`/reviews/${r.id}/reply`, { body });
      const replyPost = res.post ? { state: res.post.state, reason: res.post.reason ?? null } : null;
      setLocal({ reply: body, repliedAt: todayMyt(), replyPost });
      setComposing(false);
      setDraft('');
      if (replyPost?.state === 'failed') {
        toast({ tone: 'warning', title: 'Reply saved here, not posted.', body: `${channelName(r.channel)} did not take it: ${replyPost.reason ?? 'no reason given'}. Use Retry on the review.` });
      } else if (replyPost?.state === 'sent') {
        toast({ tone: 'success', title: retry ? `Reply posted to ${channelName(r.channel)}.` : `Reply posted to ${channelName(r.channel)}.` });
      } else {
        toast({ tone: 'success', title: 'Reply saved.', body: 'This review is not linked to a channel, so the reply is kept here.' });
      }
      onChanged?.();
    } catch (e) {
      toast({ tone: 'critical', title: 'Reply was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  function submit(e: FormEvent) { e.preventDefault(); const body = draft.trim(); if (body) void post(body); }

  const unit = [r.propertyName, r.unitNumber].filter(Boolean).join(' ');
  const stay = r.checkIn && r.checkOut ? dateRange(r.checkIn, r.checkOut) : null;

  return (
    <div className={cx('flex flex-col gap-3', compact ? '' : 'px-4 sm:px-5 py-4')}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <ChannelMark ch={r.channel} size={22} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-copy font-semibold">{r.guestName}</span>
            {!compact && (
              <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">
                {unit || 'Unit not known'}{stay ? ` · ${stay}` : ''}
              </span>
            )}
            <span className="text-meta text-muted-ink">{channelName(r.channel)} · reviewed {fmtDate(r.reviewedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Stars n={r.rating} />
          <span className="text-meta tabular-nums text-muted-ink">{r.rating.toFixed(1)}</span>
          {bad && <StatusBadge tone="critical" label="Bad review" size="sm" />}
          <StatusBadge tone={replied ? (failed ? 'warning' : 'success') : 'warning'} label={replied ? (failed ? 'Not posted' : 'Replied') : 'Needs reply'} size="sm" />
        </div>
      </div>

      {!compact && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
          {r.reservationId
            ? <Link to={`/reservations/bookings?open=${encodeURIComponent(r.reservationId)}`} className="inline-flex items-center gap-1 text-ink-2">
                <Icon name="BookOpen" size="sm" /> Reservation{r.bookingRef ? ` ${r.bookingRef}` : ''}
              </Link>
            : <span className="inline-flex items-center gap-1 text-muted-ink"><Icon name="CircleHelp" size="sm" /> No reservation matched</span>}
          {r.unitId && <Link to={`/performance/reviews?tab=all&unitId=${encodeURIComponent(r.unitId)}`} className="text-ink-2">All reviews of this unit</Link>}
        </div>
      )}

      {r.comment && <p className="m-0 text-copy leading-[1.55] [text-wrap:pretty] whitespace-pre-line">{r.comment}</p>}
      {r.scores.length > 0 && <Scores scores={r.scores} />}

      {replied && r.reply && (
        <div className="flex flex-col gap-1 bg-muted rounded-control px-3 py-2.5">
          <span className="text-caption font-semibold text-muted-ink uppercase tracking-[0.06em]">
            Your reply{r.repliedAt ? ` · ${fmtDate(r.repliedAt)}` : ''}
          </span>
          <p className="m-0 text-copy leading-[1.55] [text-wrap:pretty] whitespace-pre-line">{r.reply}</p>
        </div>
      )}
      {r.channelReply && (
        <div className="flex flex-col gap-1 border border-solid border-line rounded-control px-3 py-2.5">
          <span className="text-caption font-semibold text-muted-ink uppercase tracking-[0.06em]">Reply on {channelName(r.channel)}</span>
          <p className="m-0 text-copy leading-[1.55] whitespace-pre-line">{r.channelReply}</p>
        </div>
      )}
      {failed && (
        <div role="status" className="flex items-start gap-3 flex-wrap justify-between rounded-control border border-solid border-warning-line bg-warning-bg px-3 py-2.5">
          <span className="text-copy text-warning flex items-start gap-2 min-w-0">
            <Icon name="TriangleAlert" size="sm" />
            <span className="[overflow-wrap:anywhere]">Saved here, not posted to {channelName(r.channel)}: {r.replyPost?.reason ?? 'the channel did not take it.'}</span>
          </span>
          {canReply && r.reply && <Button size="sm" variant="secondary" loading={busy} onClick={() => post(r.reply!, true)}>Retry</Button>}
        </div>
      )}

      {canReply && !replied && !composing && (
        <Button size="sm" variant="brand" onClick={() => { setComposing(true); setDraft(''); }} className="self-start">Write a reply</Button>
      )}
      {canReply && !replied && composing && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={3} maxLength={1500}
            aria-label={`Reply to ${r.guestName}`}
            placeholder={r.linked ? `Reply to ${r.guestName}. It is posted on ${channelName(r.channel)}.` : `Reply to ${r.guestName}`}
            className="w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y" />
          <div className="flex gap-2 justify-between items-center flex-wrap">
            <span className="text-caption text-muted-ink tabular-nums">{draft.length} / 1,500</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setComposing(false)}>Cancel</Button>
              <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!draft.trim()} disabledReason="Write a reply first.">
                {r.linked ? `Post to ${channelName(r.channel)}` : 'Save reply'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
