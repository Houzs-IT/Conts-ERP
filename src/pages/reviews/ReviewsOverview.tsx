import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { Segmented } from '../../components/Metric';
import { EmptyState } from '../../components/States';
import { StaleBanner } from '../../components/DataState';
import { useApi } from '../../lib/useApi';
import { rating as fmtRating, date as fmtDate, count, plural } from '../../lib/format';
import { cx, TONE } from '../../lib/design-tokens';
import { useUrlState } from '../finance/listKit';
import { Stars } from './ReviewCard';
import { BAD_REVIEW_MAX } from '../../lib/reviewRules';

interface Summary {
  average: number | null; stars: Record<string, number>; channexConnected: boolean;
  summary: { total: number; replied: number; notPosted: number; unmatched: number; bad: number };
}
export interface PlaceRow {
  id: string; unitId: string | null; unitNumber: string | null; propertyId: string | null; propertyName: string | null; units: number;
  reviews: number; average: number | null; lastReviewAt: string | null; bad: number; needsReply: number;
  staysCheckedOut: number; staysReviewed: number; staysWithoutReview: number;
}

function Tile({ label, value, hint, tone, onClick }: { label: string; value: string; hint?: string; tone?: 'warning' | 'critical'; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={cx('rounded-card border border-solid p-4 flex flex-col gap-1.5 text-left [font-family:inherit] min-w-0',
        onClick && 'cursor-pointer', tone ? cx(TONE[tone].border, TONE[tone].bg) : 'border-line bg-card')}>
      <span className={cx('text-[11px] font-semibold tracking-[0.12em] uppercase', tone ? TONE[tone].text : 'text-muted-ink')}>{label}</span>
      <span className={cx('text-[26px] leading-none font-semibold tabular-nums', tone ? TONE[tone].text : 'text-ink')}>{value}</span>
      {hint && <span className="text-meta text-muted-ink">{hint}</span>}
    </Tag>
  );
}

/** Overview tab: the overall rating, how the stars spread and the reply backlog, then the same by building or by unit.
 *  A tile, a star row or a table row opens the matching reviews. */
export function ReviewsOverview() {
  const url = useUrlState();
  const by = url.get('by') === 'building' ? 'building' : 'unit';
  const sum = useApi<Summary>('/reviews?pageSize=1');
  const places = useApi<{ data: PlaceRow[] }>(`/reviews/units?by=${by}`);
  const s = sum.data?.summary;
  const total = s?.total ?? 0;
  const replyRate = total ? Math.round(((s?.replied ?? 0) / total) * 100) : 0;
  const open = (patch: Record<string, string | null>) => url.set({ by: null, ...patch });

  const columns: Column<PlaceRow>[] = [
    by === 'building'
      ? { key: 'place', label: 'Building', value: r => r.propertyName ?? 'No building', sub: r => plural(r.units, 'unit'), hideable: false, phone: 'title', width: 180 }
      : { key: 'place', label: 'Unit', value: r => `${r.propertyName ?? ''} ${r.unitNumber ?? ''}`.trim(), render: r => <span className="font-medium">{r.unitNumber}</span>, sub: r => r.propertyName ?? '', hideable: false, phone: 'title', width: 180 },
    { key: 'reviews', label: 'Reviews', type: 'number', value: r => r.reviews, align: 'right', width: 80 },
    { key: 'average', label: 'Average', type: 'number', value: r => r.average, align: 'right', width: 90, phone: 'right',
      render: r => r.average == null ? <span className="text-muted-ink">No reviews</span> : <span className="inline-flex items-center gap-1.5 tabular-nums"><span className="text-gold">★</span>{fmtRating(r.average)}</span> },
    { key: 'last', label: 'Last review', type: 'date', value: r => r.lastReviewAt, render: r => r.lastReviewAt ? fmtDate(r.lastReviewAt) : '—', width: 110 },
    { key: 'bad', label: 'Bad reviews', type: 'number', value: r => r.bad, align: 'right', width: 90, title: `${BAD_REVIEW_MAX} stars or fewer`,
      render: r => r.bad ? <span className={cx('font-semibold tabular-nums', TONE.critical.text)}>{r.bad}</span> : <span className="tabular-nums text-muted-ink">0</span> },
    { key: 'needsReply', label: 'Needs reply', type: 'number', value: r => r.needsReply, align: 'right', width: 90,
      render: r => r.needsReply ? <span className={cx('font-semibold tabular-nums', TONE.warning.text)}>{r.needsReply}</span> : <span className="tabular-nums text-muted-ink">0</span> },
    { key: 'rate', label: 'Review rate', type: 'number', value: r => r.staysCheckedOut ? Math.round((r.staysReviewed / r.staysCheckedOut) * 100) : null, align: 'right', width: 100,
      title: 'Finished reservations that left a review',
      render: r => r.staysCheckedOut ? <span className="tabular-nums">{Math.round((r.staysReviewed / r.staysCheckedOut) * 100)}%</span> : <span className="text-muted-ink">—</span>,
      sub: r => r.staysCheckedOut ? `${r.staysReviewed} of ${r.staysCheckedOut}` : '' },
    { key: 'without', label: 'No review yet', type: 'number', value: r => r.staysWithoutReview, align: 'right', width: 100, title: 'Finished reservations with no review' },
  ];

  return (
    <>
      {(sum.error || places.error) && <StaleBanner message={`Showing the last figures we have. ${sum.error ?? places.error}`} onRetry={() => { sum.reload(); places.reload(); }} />}

      <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_minmax(0,1.5fr)] gap-3 sm:gap-4">
        <div className="relative rounded-card bg-black text-white p-5 flex flex-col gap-2 overflow-hidden">
          <span aria-hidden className="absolute left-5 top-0 h-[2px] w-8 bg-gold" />
          <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gold">Average rating</span>
          <span className="text-[40px] leading-none font-semibold tabular-nums text-gold">{sum.data?.average != null ? fmtRating(sum.data.average) : '—'}</span>
          {sum.data?.average != null && <Stars n={sum.data.average} size="base" />}
          <span className="text-meta text-on-dark">{sum.data ? `across ${plural(total, 'review')} · ${replyRate}% replied` : 'Loading…'}</span>
        </div>
        <Card>
          <div className="px-5 py-4 flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-ink">How guests rate</span>
            {([5, 4, 3, 2, 1] as const).map(n => {
              const k = sum.data?.stars?.[n] ?? 0;
              const pct = total ? Math.round((k / total) * 100) : 0;
              return (
                <button key={n} type="button" onClick={() => open({ tab: 'all', rating: String(n) })}
                  aria-label={`${n} stars: ${k} reviews. Show them.`}
                  className="flex items-center gap-3 bg-transparent border-none p-0 cursor-pointer text-left [font-family:inherit] text-ink-2">
                  <span className="w-10 text-meta tabular-nums">{n} ★</span>
                  <span className="flex-1 h-2 rounded-full bg-muted overflow-hidden"><span className={cx('block h-full rounded-full', n <= BAD_REVIEW_MAX ? 'bg-danger-line' : 'bg-gold')} style={{ width: `${pct}%` }} /></span>
                  <span className="w-16 text-right text-meta tabular-nums text-muted-ink">{k} · {pct}%</span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Tile label="Reviews" value={sum.data ? count(total) : '—'} hint={s?.unmatched ? `${s.unmatched} with no reservation matched` : undefined} onClick={() => open({ tab: 'all' })} />
        <Tile label="Replied" value={sum.data ? `${replyRate}%` : '—'} hint={sum.data ? `${count(s?.replied ?? 0)} of ${count(total)}` : undefined} />
        <Tile label="Needs reply" value={sum.data ? count(total - (s?.replied ?? 0)) : '—'} tone={total - (s?.replied ?? 0) ? 'warning' : undefined}
          hint={s?.notPosted ? `${s.notPosted} saved but not posted` : undefined} onClick={() => open({ tab: 'all', reply: 'needs_reply' })} />
        <Tile label="Bad reviews" value={sum.data ? count(s?.bad ?? 0) : '—'} tone={s?.bad ? 'critical' : undefined} hint={`${BAD_REVIEW_MAX} stars or fewer`} onClick={() => open({ tab: 'bad' })} />
      </div>

      {sum.data && total === 0 && (
        <EmptyState icon="Star" title="No reviews yet"
          body={sum.data.channexConnected
            ? 'Reviews arrive from Airbnb and Booking.com through Channex. If none come in after guests check out, check that the Messages & Reviews app is installed in Channex.'
            : 'Reviews arrive from Airbnb and Booking.com through Channex, which is not connected on this system.'} />
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="m-0 text-heading font-semibold">{by === 'building' ? 'By building' : 'By unit'}</h2>
        <Segmented label="Group reviews" value={by} onChange={k => url.set({ by: k === 'unit' ? null : k })}
          options={[{ key: 'building', label: 'By building' }, { key: 'unit', label: 'By unit' }]} />
      </div>
      <DataTable<PlaceRow> id={`reviews.${by}`} urlPrefix="o" columns={columns} rows={places.data?.data ?? null} rowKey={r => r.id}
        loading={places.loading} error={places.error} onRetry={places.reload} defaultSort="reviews:desc" pageSize={0} noViews
        noun={by === 'building' ? ['building', 'buildings'] : ['unit', 'units']} exportName={`reviews-by-${by}`}
        onRowClick={r => open(by === 'building' ? { tab: 'all', propertyId: r.propertyId, unitId: null } : { tab: 'all', unitId: r.unitId, propertyId: null })}
        empty={{ title: 'No reviews or finished reservations yet', icon: 'Star' }} />
    </>
  );
}
