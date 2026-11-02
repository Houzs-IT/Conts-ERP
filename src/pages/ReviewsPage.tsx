import PageHeader from '../components/PageHeader';
import { TabBar, panelId } from '../components/TabBar';
import { useSession } from '../lib/session';
import { mayWork } from '../lib/areaAccess';
import { useUrlState } from './finance/listKit';
import { ReviewsOverview } from './reviews/ReviewsOverview';
import { ReviewFeed } from './reviews/ReviewFeed';
import { OutstandingStays } from './reviews/OutstandingStays';
import { BAD_REVIEW_MAX } from '../lib/reviewRules';

type Tab = 'overview' | 'all' | 'bad' | 'outstanding';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'all', label: 'All reviews' },
  { key: 'bad', label: 'Bad reviews' },
  { key: 'outstanding', label: 'Outstanding' },
];

/** Reviews (owner, 2 Nov 2026): the overall picture with a switch to see it by building or by unit; every review; every
 *  bad review (BAD_REVIEW_MAX stars or fewer); and the finished reservations that have not left a review yet. The tab
 *  and every filter live in the address, so a link (from a unit page, a row in Overview) opens the same view. */
export default function ReviewsPage() {
  const url = useUrlState();
  const { user } = useSession();
  const canReply = mayWork(user, 'pricing');
  const raw = url.get('tab');
  const tab: Tab = (TABS.some(t => t.key === raw) ? raw : 'overview') as Tab;

  return (
    <>
      <PageHeader title="Reviews" sub={`Guest reviews from every channel · a bad review is ${BAD_REVIEW_MAX} stars or fewer`} />
      <TabBar id="reviews" label="Reviews views" tabs={TABS} value={tab}
        // Drill-down filters carry across tabs (a unit picked in Overview stays picked); the list's own ones do not.
        onChange={k => url.set({ tab: k === 'overview' ? null : k, page: null, rating: null, reply: null, window: null, from: null, to: null, q: null, matched: null })} />
      <div id={panelId('reviews')} role="tabpanel" className="flex flex-col gap-4 min-w-0">
        {tab === 'overview' && <ReviewsOverview />}
        {tab === 'all' && <ReviewFeed bad={false} canReply={canReply} />}
        {tab === 'bad' && <ReviewFeed bad canReply={canReply} />}
        {tab === 'outstanding' && <OutstandingStays />}
      </div>
    </>
  );
}
