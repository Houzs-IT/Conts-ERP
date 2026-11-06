import { DataTable, type Column } from '../../components/DataTable';
import { Segmented } from '../../components/Metric';
import { StaleBanner } from '../../components/DataState';
import { useApi } from '../../lib/useApi';
import { date as fmtDate, plural } from '../../lib/format';
import { cx, TONE } from '../../lib/design-tokens';
import { useUrlState } from '../finance/listKit';
import { CATEGORY_FLAG_BELOW, categoryFlagged } from '../../lib/reviewRules';
import { ReviewFeed } from './ReviewFeed';

interface Row { cleanerId: string; name: string; reviews: number; average: number; low: number; lastReviewAt: string }

/** Cleanliness by cleaner: each cleaner's average cleanliness score over the stays they readied (the clean jobs
 *  between the previous checkout and the guest's check-in), lowest first. A row opens that cleaner's reviews. */
export function CleanersView({ canReply }: { canReply: boolean }) {
  const url = useUrlState();
  const months = ['3', '6', '12'].includes(url.get('months')) ? url.get('months') : '6';
  const cleaner = url.get('cleaner');
  const { data, loading, error, reload } = useApi<{ data: Row[]; lowBelow: number; from: string }>(`/reviews/cleaners?months=${months}`);
  const columns: Column<Row>[] = [
    { key: 'name', label: 'Cleaner', value: r => r.name, hideable: false, phone: 'title', width: 200 },
    { key: 'average', label: 'Cleanliness', type: 'number', align: 'right', width: 110, phone: 'right', value: r => r.average, title: 'Average, out of 5, Airbnb and Booking.com together',
      render: r => <span className={cx('tabular-nums', categoryFlagged('cleanliness', r.average) && cx('font-semibold', TONE.critical.text))}>{r.average.toFixed(2)}</span> },
    { key: 'reviews', label: 'Reviews', type: 'number', align: 'right', width: 90, value: r => r.reviews, sub: r => plural(r.reviews, 'stay') },
    { key: 'low', label: 'Low scores', type: 'number', align: 'right', width: 100, value: r => r.low, title: `Cleanliness under ${data?.lowBelow ?? ''}`,
      render: r => r.low ? <span className={cx('font-semibold tabular-nums', TONE.warning.text)}>{r.low}</span> : <span className="text-muted-ink tabular-nums">0</span> },
    { key: 'last', label: 'Last review', type: 'date', width: 120, value: r => r.lastReviewAt, render: r => fmtDate(r.lastReviewAt) },
  ];
  const picked = data?.data.find(r => r.cleanerId === cleaner);
  return (
    <>
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="m-0 text-copy text-muted-ink max-w-[640px]">Each cleaner's average cleanliness score over the reservations they cleaned for. Flagged under {CATEGORY_FLAG_BELOW.cleanliness} out of 5.</p>
        <Segmented label="Months" value={months as '3' | '6' | '12'} onChange={k => url.set({ months: k === '6' ? null : k })}
          options={[{ key: '3', label: '3 months' }, { key: '6', label: '6 months' }, { key: '12', label: '12 months' }]} />
      </div>
      <DataTable<Row> id="reviews.cleaners" urlPrefix="c" columns={columns} rows={data?.data ?? null} rowKey={r => r.cleanerId}
        loading={loading} error={error} onRetry={reload} pageSize={0} noViews defaultSort="average:asc" noun={['cleaner', 'cleaners']}
        exportName="cleanliness-by-cleaner" rowTone={r => (categoryFlagged('cleanliness', r.average) ? 'critical' : null)}
        onRowClick={r => url.set({ cleaner: r.cleanerId === cleaner ? null : r.cleanerId })}
        empty={{ title: 'No cleanliness scores linked to a cleaner yet', icon: 'Sparkles' }} />
      {cleaner && (
        <>
          <h2 className="m-0 text-heading font-semibold">Reviews of stays {picked?.name ?? 'this cleaner'} cleaned for</h2>
          <ReviewFeed bad={false} canReply={canReply} fixed={{ cleaner }} />
        </>
      )}
    </>
  );
}
