import PageHeader from '../components/PageHeader';
import { TabBar, panelId } from '../components/TabBar';
import { useSession } from '../lib/session';
import { mayWork } from '../lib/areaAccess';
import { useUrlState } from './finance/listKit';
import { ReviewsOverview } from './reviews/ReviewsOverview';
import { ReviewFeed } from './reviews/ReviewFeed';
import { OutstandingStays } from './reviews/OutstandingStays';
import { GuestReviews } from './reviews/GuestReviews';
import { ReviewHealth } from './reviews/ReviewHealth';
import { CleanersView } from './reviews/CleanersView';
import { BAD_REVIEW_MAX } from '../lib/reviewRules';
import { useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { DemoReviewModal, useDemoOn } from '../components/demo/DemoRecords';

type Tab = 'overview' | 'all' | 'bad' | 'guests' | 'health' | 'cleaners' | 'outstanding';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'all', label: 'All reviews' },
  { key: 'bad', label: 'Bad reviews' },
  { key: 'guests', label: 'Review guests' },
  { key: 'health', label: 'Unit health' },
  { key: 'cleaners', label: 'Cleaners' },
  { key: 'outstanding', label: 'Outstanding' },
];

/** Reviews (owner, 2 Nov 2026; Airbnb's way, 3 Nov 2026): the overall picture with a switch to see it by building or
 *  by unit; every review; every bad review (BAD_REVIEW_MAX stars or fewer); reviewing Airbnb guests; how each unit is
 *  rated by category and month; cleanliness by cleaner; and the finished reservations that have not left a review yet. The tab
 *  and every filter live in the address, so a link (from a unit page, a row in Overview) opens the same view. */
export default function ReviewsPage() {
  const url = useUrlState();
  const { user } = useSession();
  const canReply = mayWork(user, 'reviews');
  const raw = url.get('tab');
  const tab: Tab = (TABS.some(t => t.key === raw) ? raw : 'overview') as Tab;
  const demoOn = useDemoOn();
  const [adding, setAdding] = useState(false);
  // A new sample review shows on the next read of the list.
  const [round, setRound] = useState(0);

  return (
    <>
      <PageHeader title="Reviews" sub={`Guest reviews from every channel · Airbnb out of 5 stars, Booking.com out of 10 · a bad review is ${BAD_REVIEW_MAX} stars or fewer`}
        primary={demoOn ? <Button size="sm" variant="primary" icon={<Icon name="FlaskConical" size="sm" />} onClick={() => setAdding(true)}>Sample review</Button> : undefined} />
      {adding && <DemoReviewModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setRound(n => n + 1); url.set({ tab: 'all' }); }} />}
      <TabBar id="reviews" label="Reviews views" tabs={TABS} value={tab}
        // Drill-down filters carry across tabs (a unit picked in Overview stays picked); the list's own ones do not.
        onChange={k => url.set({ tab: k === 'overview' ? null : k, page: null, rating: null, reply: null, window: null, from: null, to: null, q: null, matched: null, hidden: null, tag: null, lowClean: null, cleaner: null, gview: null, months: null })} />
      <div key={round} id={panelId('reviews')} role="tabpanel" className="flex flex-col gap-4 min-w-0">
        {tab === 'overview' && <ReviewsOverview />}
        {tab === 'all' && <ReviewFeed bad={false} canReply={canReply} />}
        {tab === 'bad' && <ReviewFeed bad canReply={canReply} />}
        {tab === 'guests' && <GuestReviews canWrite={canReply} />}
        {tab === 'health' && <ReviewHealth />}
        {tab === 'cleaners' && <CleanersView canReply={canReply} />}
        {tab === 'outstanding' && <OutstandingStays />}
      </div>
    </>
  );
}
