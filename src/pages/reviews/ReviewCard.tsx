import { useState, type FormEvent } from 'react';
import { DemoReviewActions, useDemoOn } from '../../components/demo/DemoRecords';
import { SampleMark } from '../../components/DemoMode';
import { Link } from 'react-router-dom';
import ChannelMark, { channelLabel } from '../../components/ChannelMark';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { api, errorMessage, ApiFailure } from '../../lib/api';
import { date as fmtDate, todayMyt } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { isBadReview, scaleText, type Scale } from '../../lib/reviewRules';
import type { BookingChannel } from '../../lib/types';
import { Avatar, Clamp, NativeScore, Notice, TagChips, CategoryRow, splitBooking, stayLine } from './reviewUi';

export { Stars } from './reviewUi';

export interface CleanJob { taskId: string; kind: string; state: string; day: string; cleaners: { id: string; name: string }[] }

/** A guest review as /api/reviews and the reservation detail send it (functions/_lib/reviews.ts reviewOut). */
export interface Review {
  /** Demo mode: a sample review, or a real one changed in Demo mode. */
  sample?: 'demo' | 'shadow';
  id: string; channel: BookingChannel; rating: number; comment: string | null; reviewedAt: string;
  /** The score on the channel's own scale: Airbnb 1-5 stars, Booking.com out of 10. */
  native: Scale;
  guestName: string; unitId: string | null; unitNumber: string | null; propertyId: string | null; propertyName: string | null;
  reservationId: string | null; checkIn: string | null; checkOut: string | null; bookingRef: string | null;
  reply: string | null; repliedAt: string | null; channelReply: string | null;
  scores: { category: string; score: number }[];
  categories: { key: string; label: string; score10: number; native: Scale; outOf5: number }[];
  tags: { code: string; label: string; tone: 'positive' | 'negative' | 'other' }[];
  hidden: boolean;
  lowCleanliness: boolean;
  cleanJobs: CleanJob[] | null;
  linked: boolean;
  replyPost: { state: 'sent' | 'failed'; reason: string | null } | null;
}

const KIND: Record<string, string> = { turnover: 'Cleaning job', deep_clean: 'Deep clean', light_clean: 'Light clean' };

/** One review laid out like Airbnb's: the guest's initials, name and stay, the stars (Booking.com: its score out of
 *  10, and Liked / Disliked), the text with Show more, category scores, tags, then the host's response. Low cleanliness
 *  shows the clean before the stay and who did it. Replying happens on the card, with an AI draft when set up. */
export function ReviewCard({ review, canReply, onChanged, compact }: {
  review: Review; canReply: boolean; onChanged?: () => void; compact?: boolean;
}) {
  const toast = useToast();
  const demoOn = useDemoOn();
  if (demoOn) canReply = false;
  const [local, setLocal] = useState<Pick<Review, 'reply' | 'repliedAt' | 'replyPost'> | null>(null);
  const r = local ? { ...review, ...local } : review;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [showCats, setShowCats] = useState(false);
  const replied = r.reply != null;
  const bad = isBadReview(r.rating);
  const failed = r.replyPost?.state === 'failed';
  const booking = r.channel === 'booking_com';
  const parts = booking ? splitBooking(r.comment) : null;
  const name = channelLabel(r.channel);

  async function post(body: string, retry = false) {
    setBusy(true);
    try {
      const res = await api.post<{ post: { state: 'sent' | 'failed'; reason?: string | null } | null }>(`/reviews/${r.id}/reply`, { body });
      const replyPost = res.post ? { state: res.post.state, reason: res.post.reason ?? null } : null;
      setLocal({ reply: body, repliedAt: todayMyt(), replyPost });
      setComposing(false);
      setDraft('');
      if (replyPost?.state === 'failed') {
        toast({ tone: 'warning', title: 'Reply saved here, not posted.', body: `${name} did not take it: ${replyPost.reason ?? 'no reason given'}. Use Retry on the review.` });
      } else if (replyPost?.state === 'sent') {
        toast({ tone: 'success', title: retry ? `Reply posted to ${name} on retry.` : `Reply posted to ${name}.` });
      } else {
        toast({ tone: 'success', title: 'Reply saved.', body: 'This review is not linked to a channel, so the reply is kept here.' });
      }
      onChanged?.();
    } catch (e) {
      toast({ tone: 'critical', title: 'Reply was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  async function aiDraft() {
    setDrafting(true);
    setAiNote(null);
    try {
      const res = await api.post<{ draft: string }>(`/reviews/${r.id}/draft`, {});
      setDraft(res.draft);
      setAiNote('AI draft. Read it and change anything before you post.');
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : undefined;
      setAiNote(code === 'NOT_CONFIGURED' ? 'AI drafting is not set up. Write the reply yourself.' : errorMessage(e, 'No draft this time. Write the reply yourself.'));
    } finally { setDrafting(false); }
  }

  function submit(e: FormEvent) { e.preventDefault(); const body = draft.trim(); if (body) void post(body); }

  const unit = [r.propertyName, r.unitNumber].filter(Boolean).join(' ');
  const stay = stayLine(r.checkIn, r.checkOut);
  const cleaners = [...new Map((r.cleanJobs ?? []).flatMap(j => j.cleaners).map(c => [c.id, c])).values()];
  const cleanliness = r.categories.find(c => c.key === 'cleanliness');

  return (
    <div className={cx('flex flex-col gap-3.5', compact ? '' : 'px-4 sm:px-6 py-5')}>
      {/* Who and when: Airbnb's avatar, name and stay line. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={r.guestName} size={compact ? 36 : 44} />
          <div className="flex flex-col min-w-0">
            <span className="flex items-center gap-1.5 min-w-0"><span className="text-copy font-semibold truncate">{r.guestName}</span><SampleMark kind={r.sample} /></span>
            <span className="text-meta text-muted-ink">{stay ?? `Reviewed ${fmtDate(r.reviewedAt)}`}</span>
            {!compact && unit && <span className="text-meta text-muted-ink truncate">{unit}</span>}
          </div>
        </div>
        <span className="flex items-center gap-1.5 shrink-0 text-meta text-muted-ink"><ChannelMark ch={r.channel} size={18} /><span className="hidden sm:inline">{name}</span></span>
      </div>

      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        <NativeScore s={r.native} />
        <span className="text-meta text-muted-ink">· {fmtDate(r.reviewedAt)}</span>
        {bad && <StatusBadge entity="review" value="bad" size="sm" />}
        {r.hidden && <StatusBadge entity="review" value="hidden" size="sm" />}
        <StatusBadge entity="review" value={replied ? (failed ? 'not_posted' : 'replied') : 'needs_reply'} size="sm" />
      </div>

      {r.hidden && (
        <Notice icon="EyeOff" title="Hidden until you review the guest" tone="info">
          Airbnb shows this review, to you and on the listing, once you have reviewed {r.guestName.split(' ')[0]}. Review guests on the Review guests tab.
        </Notice>
      )}

      {booking && parts ? (
        <div className="flex flex-col gap-2">
          {parts.headline && <Clamp text={parts.headline} />}
          {parts.liked && <p className="m-0 text-copy leading-[1.55] flex gap-2"><span className="text-success shrink-0"><Icon name="Plus" size="sm" /></span><span><span className="sr-only">Liked: </span>{parts.liked}</span></p>}
          {parts.disliked && <p className="m-0 text-copy leading-[1.55] flex gap-2"><span className="text-critical shrink-0"><Icon name="Minus" size="sm" /></span><span><span className="sr-only">Disliked: </span>{parts.disliked}</span></p>}
        </div>
      ) : r.comment ? <Clamp text={r.comment} /> : <p className="m-0 text-copy text-muted-ink">No written review, score only.</p>}

      {r.categories.length > 0 && (
        <div className="flex flex-col">
          <button type="button" onClick={() => setShowCats(v => !v)} aria-expanded={showCats}
            className="self-start bg-transparent border-none p-0 cursor-pointer [font-family:inherit] text-meta font-semibold text-ink underline underline-offset-2">
            {showCats ? 'Hide ratings by category' : `Ratings by category${cleanliness ? ` · Cleanliness ${scaleText(cleanliness.native)}` : ''}`}
          </button>
          {showCats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 mt-1.5">
              {r.categories.map(c => <CategoryRow key={c.key} k={c.key} score={c.native.value} max={c.native.max} flagKey={c.native.max === 5} />)}
            </div>
          )}
        </div>
      )}
      <TagChips tags={r.tags} />

      {r.lowCleanliness && !compact && (
        <Notice icon="Sparkles" tone="warning" title={`Low cleanliness${cleanliness ? ` (${scaleText(cleanliness.native)})` : ''}`}
          action={cleaners.length === 1 ? <Link to={`/performance/reviews?tab=cleaners&cleaner=${encodeURIComponent(cleaners[0].id)}`} className="text-meta text-ink-2 whitespace-nowrap">Their reviews</Link> : undefined}>
          {r.cleanJobs?.length
            ? <>Cleaned before this reservation: {r.cleanJobs.map(j => `${KIND[j.kind] ?? j.kind} on ${fmtDate(j.day)}${j.state === 'resolved' ? '' : ' (not marked done)'}`).join('; ')}
                {' · '}{cleaners.length ? `by ${cleaners.map(c => c.name).join(', ')}` : 'no cleaner assigned'}</>
            : 'No clean job was recorded on this unit before the stay.'}
        </Notice>
      )}

      {!compact && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
          {r.reservationId
            ? <Link to={`/reservations/bookings?open=${encodeURIComponent(r.reservationId)}`} className="inline-flex items-center gap-1 text-ink-2">
                <Icon name="BookOpen" size="sm" /> Reservation{r.bookingRef ? ` ${r.bookingRef}` : ''}
              </Link>
            : <span className="inline-flex items-center gap-1 text-muted-ink"><Icon name="CircleHelp" size="sm" /> No reservation matched</span>}
          {r.unitId && <Link to={`/performance/reviews?tab=health&unitId=${encodeURIComponent(r.unitId)}`} className="text-ink-2">Unit health</Link>}
        </div>
      )}

      {/* The host's response, under the review as on Airbnb. */}
      {replied && r.reply && (
        <div className="flex gap-3 pl-3 sm:pl-4 [border-left:2px_solid_var(--color-line)]">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-meta font-semibold">Response from you{r.repliedAt ? <span className="font-normal text-muted-ink"> · {fmtDate(r.repliedAt)}</span> : null}</span>
            <Clamp text={r.reply} lines={3} />
          </div>
        </div>
      )}
      {r.channelReply && (
        <div className="flex flex-col gap-1 pl-3 sm:pl-4 [border-left:2px_solid_var(--color-line)]">
          <span className="text-meta font-semibold">Response on {name}</span>
          <Clamp text={r.channelReply} lines={3} />
        </div>
      )}
      {failed && (
        <Notice icon="TriangleAlert" tone="warning" title={`Saved here, not posted to ${name}`}
          action={canReply && r.reply ? <Button size="sm" variant="secondary" loading={busy} onClick={() => post(r.reply!, true)}>Retry</Button> : undefined}>
          {r.replyPost?.reason ?? 'The channel did not take it.'}
        </Notice>
      )}

      {/* Demo mode: changed as sample data only, never answered on the channel. */}
      {demoOn && <DemoReviewActions review={r} onChanged={() => onChanged?.()} />}
      {canReply && !replied && !composing && (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="brand" onClick={() => { setComposing(true); setDraft(''); setAiNote(null); }}>Respond</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Sparkles" size="sm" />} loading={drafting} onClick={() => { setComposing(true); void aiDraft(); }}>Draft reply</Button>
        </div>
      )}
      {canReply && !replied && composing && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={4} maxLength={1500}
            aria-label={`Response to ${r.guestName}`}
            placeholder={r.linked ? `Write a public response to ${r.guestName}. It is posted on ${name}.` : `Response to ${r.guestName}`}
            className="w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y" />
          {aiNote && <span className="text-caption text-muted-ink flex items-center gap-1.5"><Icon name="Sparkles" size="sm" />{aiNote}</span>}
          <div className="flex gap-2 justify-between items-center flex-wrap">
            <span className="text-caption text-muted-ink tabular-nums">{draft.length} / 1,500</span>
            <div className="flex gap-2 flex-wrap">
              <Button type="button" size="sm" variant="secondary" icon={<Icon name="Sparkles" size="sm" />} loading={drafting} onClick={() => void aiDraft()}>{draft ? 'Draft again' : 'Draft reply'}</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setComposing(false)}>Back</Button>
              <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!draft.trim()} disabledReason="Write a response first.">
                {r.linked ? `Post to ${name}` : 'Save response'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
