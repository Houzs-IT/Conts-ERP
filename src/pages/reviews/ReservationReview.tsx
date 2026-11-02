import { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { maySee, mayWork } from '../../lib/areaAccess';
import { todayMyt } from '../../lib/format';
import { windowClosed, daysSince } from '../../lib/reviewRules';
import { ReviewCard, type Review } from './ReviewCard';

/** The reservation drawer's Review section: the review this reservation left, or, once the guest has checked out,
 *  that it has none yet and whether the channel still lets the guest leave one. Shown to people who can open Reviews.
 *  Its own module so the drawer, which is in the first bundle, stays small. */
export default function ReservationReview({ review, threadId, checkOut, state, channel }: {
  review: Review | null; threadId: string | null; checkOut: string; state: string; channel: string;
}) {
  const { user } = useSession();
  if (!maySee(user, 'pricing')) return null;
  const today = todayMyt();
  const over = checkOut < today && !['cancelled', 'no_show', 'inquiry', 'pending'].includes(state);
  if (!review && !over) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">Review</div>
        {threadId && <Link to={`/communication/inbox?thread=${encodeURIComponent(threadId)}`} className="text-meta text-ink underline">Open messages</Link>}
      </div>
      {review ? (
        <div className="rounded-card border border-solid border-line bg-card p-3.5">
          <Suspense fallback={null}><ReviewCard review={review} canReply={mayWork(user, 'pricing')} compact /></Suspense>
        </div>
      ) : (
        <div className="text-copy text-muted-ink">
          No review yet · checked out {daysSince(checkOut, today)} days ago
          {windowClosed(channel, checkOut, today) ? ' · the review window has closed' : ''}
        </div>
      )}
    </div>
  );
}
