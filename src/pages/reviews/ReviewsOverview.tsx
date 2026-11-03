import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { Segmented } from '../../components/Metric';
import { EmptyState } from '../../components/States';
import { StaleBanner } from '../../components/DataState';
import { useApi } from '../../lib/useApi';
import { rating as fmtRating, date as fmtDate, count, plural } from '../../lib/format';
import { cx, TONE } from '../../lib/design-tokens';
import { useUrlState } from '../finance/listKit';
import { BAD_REVIEW_MAX, AIRBNB_CATEGORIES, CATEGORY_FLAG_BELOW, categoryLabel, categoryFlagged } from '../../lib/reviewRules';
import { CategoryGrid, Distribution, TenBox } from './reviewUi';
import type { CategoryAverages } from './ReviewHealth';

interface Summary {
  average: number | null; stars: Record<string, number>; channexConnected: boolean;
  summary: { total: number; replied: number; notPosted: number; unmatched: number; bad: number; hidden: number };
  byChannel: { airbnb: { reviews: number; average: number | null }; booking_com: { reviews: number; average: number | null } };
}
export interface PlaceRow {
  id: string; unitId: string | null; unitNumber: string | null; propertyId: string | null; propertyName: string | null; units: number;
  reviews: number; average: number | null; lastReviewAt: string | null; bad: number; needsReply: number;
  staysCheckedOut: number; staysReviewed: number; staysWithoutReview: number;
  hidden: number; categories: CategoryAverages; flagged: string[]; topComplaint: { code: string; label: string; count: number } | null;
}
interface GuestCounts { counts: { due: number; notWritten: number; needsApproval: number; failed: number; closingSoon: number } }

function Tile({ label, value, hint, tone, onClick }: { label: string; value: string; hint?: string; tone?: 'warning' | 'critical' | 'info'; onClick?: () => void }) {
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

/** Overview tab, laid out like Airbnb's host Reviews page: the overall rating big with its star and how many reviews,
 *  the six categories each with an icon and a thin bar, and the 5-to-1 spread; each channel on its own scale beside
 *  it. Then the work waiting (replies, guests to review, bad and hidden reviews), and the same by building or unit
 *  with every category's average and the categories under the flag line. */
export function ReviewsOverview() {
  const url = useUrlState();
  const by = url.get('by') === 'building' ? 'building' : 'unit';
  const sum = useApi<Summary>('/reviews?pageSize=1');
  const places = useApi<{ data: PlaceRow[] }>(`/reviews/units?by=${by}`);
  const health = useApi<{ categories: CategoryAverages; flagged: string[] }>('/reviews/health?months=36');
  const guests = useApi<GuestCounts>('/reviews/guest-reviews?view=due');
  const s = sum.data?.summary;
  const total = s?.total ?? 0;
  const replyRate = total ? Math.round(((s?.replied ?? 0) / total) * 100) : 0;
  const open = (patch: Record<string, string | null>) => url.set({ by: null, ...patch });
  const air = sum.data?.byChannel.airbnb, bdc = sum.data?.byChannel.booking_com;
  const g = guests.data?.counts;

  const catCols: Column<PlaceRow>[] = AIRBNB_CATEGORIES.map(k => ({
    key: `cat_${k}`, label: categoryLabel(k), type: 'number' as const, align: 'right' as const, width: 96,
    title: `${categoryLabel(k)}, out of 5, Airbnb and Booking.com together${CATEGORY_FLAG_BELOW[k] ? `. Flagged under ${CATEGORY_FLAG_BELOW[k]}` : ''}`,
    value: (r: PlaceRow) => r.categories[k]?.average ?? null,
    render: (r: PlaceRow) => {
      const c = r.categories[k];
      if (!c) return <span className="text-muted-ink">–</span>;
      const flagged = categoryFlagged(k, c.average);
      return <span className={cx('tabular-nums', flagged && cx('font-semibold', TONE.critical.text))}>{c.average.toFixed(2)}{flagged ? ' !' : ''}</span>;
    },
  }));

  const columns: Column<PlaceRow>[] = [
    by === 'building'
      ? { key: 'place', label: 'Building', value: r => r.propertyName ?? 'No building', sub: r => plural(r.units, 'unit'), hideable: false, phone: 'title', width: 180 }
      : { key: 'place', label: 'Unit', value: r => `${r.propertyName ?? ''} ${r.unitNumber ?? ''}`.trim(), render: r => <span className="font-medium">{r.unitNumber}</span>, sub: r => r.propertyName ?? '', hideable: false, phone: 'title', width: 180 },
    { key: 'reviews', label: 'Reviews', type: 'number', value: r => r.reviews, align: 'right', width: 80 },
    { key: 'average', label: 'Average', type: 'number', value: r => r.average, align: 'right', width: 90, phone: 'right', title: 'Out of 5, Airbnb and Booking.com together',
      render: r => r.average == null ? <span className="text-muted-ink">No reviews</span> : <span className="inline-flex items-center gap-1.5 tabular-nums"><span className="text-ink">★</span>{fmtRating(r.average)}</span> },
    ...catCols,
    { key: 'flags', label: 'Flags', sortable: false, width: 140, phone: 'meta',
      value: r => r.flagged.map(categoryLabel).join(', '),
      render: r => r.flagged.length ? <span className={cx('text-meta font-medium', TONE.critical.text)}>{r.flagged.map(k => `${categoryLabel(k)} under ${CATEGORY_FLAG_BELOW[k]}`).join(', ')}</span> : <span className="text-muted-ink">–</span> },
    { key: 'complaint', label: 'Top complaint', width: 150, value: r => r.topComplaint?.label ?? '', render: r => r.topComplaint ? <span className="text-meta">{r.topComplaint.label} <span className="text-muted-ink">({r.topComplaint.count})</span></span> : <span className="text-muted-ink">–</span> },
    { key: 'last', label: 'Last review', type: 'date', value: r => r.lastReviewAt, render: r => r.lastReviewAt ? fmtDate(r.lastReviewAt) : '–', width: 110 },
    { key: 'bad', label: 'Bad reviews', type: 'number', value: r => r.bad, align: 'right', width: 90, title: `${BAD_REVIEW_MAX} stars or fewer`,
      render: r => r.bad ? <span className={cx('font-semibold tabular-nums', TONE.critical.text)}>{r.bad}</span> : <span className="tabular-nums text-muted-ink">0</span> },
    { key: 'needsReply', label: 'Needs reply', type: 'number', value: r => r.needsReply, align: 'right', width: 90,
      render: r => r.needsReply ? <span className={cx('font-semibold tabular-nums', TONE.warning.text)}>{r.needsReply}</span> : <span className="tabular-nums text-muted-ink">0</span> },
    { key: 'hidden', label: 'Hidden', type: 'number', value: r => r.hidden, align: 'right', width: 80, title: 'Airbnb reviews hidden until you review the guest' },
    { key: 'rate', label: 'Review rate', type: 'number', value: r => r.staysCheckedOut ? Math.round((r.staysReviewed / r.staysCheckedOut) * 100) : null, align: 'right', width: 100,
      title: 'Finished reservations that left a review',
      render: r => r.staysCheckedOut ? <span className="tabular-nums">{Math.round((r.staysReviewed / r.staysCheckedOut) * 100)}%</span> : <span className="text-muted-ink">–</span>,
      sub: r => r.staysCheckedOut ? `${r.staysReviewed} of ${r.staysCheckedOut}` : '' },
    { key: 'without', label: 'No review yet', type: 'number', value: r => r.staysWithoutReview, align: 'right', width: 100, title: 'Finished reservations with no review' },
  ];

  return (
    <>
      {(sum.error || places.error) && <StaleBanner message={`Showing the last figures we have. ${sum.error ?? places.error}`} onRetry={() => { sum.reload(); places.reload(); health.reload(); }} />}

      <Card>
        <div className="px-5 sm:px-7 py-6 flex flex-col gap-6">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-[40px] sm:text-[48px] leading-none font-semibold tabular-nums">
                <span aria-hidden className="text-[32px] sm:text-[40px]">★</span>{sum.data?.average != null ? fmtRating(sum.data.average) : '–'}
              </span>
              <span className="text-copy text-muted-ink">{sum.data ? `${plural(total, 'review')} · ${replyRate}% replied` : 'Loading…'}</span>
              <span className="text-caption text-muted-ink">Out of 5, Airbnb and Booking.com together</span>
            </div>
            <div className="grid grid-cols-2 sm:flex gap-3 w-full sm:w-auto">
              <button type="button" onClick={() => open({ tab: 'all', channel: 'airbnb' })}
                className="flex flex-col items-start gap-1 rounded-card border border-solid border-line bg-card px-4 py-3 cursor-pointer [font-family:inherit] text-left min-w-0 sm:min-w-[150px]">
                <span className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">Airbnb</span>
                <span className="text-heading font-semibold tabular-nums">★ {air?.average != null ? air.average.toFixed(2) : '–'} <span className="text-meta font-normal text-muted-ink">/ 5</span></span>
                <span className="text-caption text-muted-ink">{plural(air?.reviews ?? 0, 'review')}</span>
              </button>
              <button type="button" onClick={() => open({ tab: 'all', channel: 'booking_com' })}
                className="flex flex-col items-start gap-1 rounded-card border border-solid border-line bg-card px-4 py-3 cursor-pointer [font-family:inherit] text-left min-w-0 sm:min-w-[150px]">
                <span className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">Booking.com</span>
                <span className="flex items-center gap-2">{bdc?.average != null ? <TenBox value={Math.round(bdc.average * 10) / 10} /> : <span className="text-heading">–</span>}<span className="text-meta text-muted-ink">/ 10</span></span>
                <span className="text-caption text-muted-ink">{plural(bdc?.reviews ?? 0, 'review')}</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-6 lg:gap-10">
            <div className="flex flex-col gap-2">
              <span className="text-copy font-semibold">Overall rating</span>
              <Distribution stars={sum.data?.stars ?? {}} total={total} onPick={n => open({ tab: 'all', rating: String(n) })} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-copy font-semibold">By category <span className="font-normal text-meta text-muted-ink">· out of 5, both channels</span></span>
              <CategoryGrid keys={AIRBNB_CATEGORIES} scores={health.data?.categories ?? {}} max={5} flag />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        <Tile label="Needs reply" value={sum.data ? count(total - (s?.replied ?? 0)) : '–'} tone={total - (s?.replied ?? 0) ? 'warning' : undefined}
          hint={s?.notPosted ? `${s.notPosted} saved but not posted` : `${replyRate}% replied`} onClick={() => open({ tab: 'all', reply: 'needs_reply' })} />
        <Tile label="Guests to review" value={g ? count(g.due) : '–'} tone={g?.closingSoon ? 'warning' : g?.due ? 'info' : undefined}
          hint={g ? (g.closingSoon ? `${g.closingSoon} close within 2 days` : g.needsApproval ? `${g.needsApproval} need approval` : 'Airbnb, 14 days after checkout') : undefined} onClick={() => open({ tab: 'guests' })} />
        <Tile label="Hidden" value={sum.data ? count(s?.hidden ?? 0) : '–'} tone={s?.hidden ? 'info' : undefined} hint="Until you review the guest" onClick={() => open({ tab: 'all', hidden: '1' })} />
        <Tile label="Bad reviews" value={sum.data ? count(s?.bad ?? 0) : '–'} tone={s?.bad ? 'critical' : undefined} hint={`${BAD_REVIEW_MAX} stars or fewer`} onClick={() => open({ tab: 'bad' })} />
        <Tile label="Flagged" value={health.data ? count(health.data.flagged.length) : '–'} tone={health.data?.flagged.length ? 'critical' : undefined}
          hint={health.data?.flagged.length ? health.data.flagged.map(categoryLabel).join(', ') : `Cleanliness under ${CATEGORY_FLAG_BELOW.cleanliness}`} onClick={() => open({ tab: 'health' })} />
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
      <DataTable<PlaceRow> id={`reviews.${by}.v2`} urlPrefix="o" columns={columns} rows={places.data?.data ?? null} rowKey={r => r.id}
        loading={places.loading} error={places.error} onRetry={places.reload} defaultSort="reviews:desc" pageSize={0} noViews
        noun={by === 'building' ? ['building', 'buildings'] : ['unit', 'units']} exportName={`reviews-by-${by}`}
        rowTone={r => (r.flagged.length ? 'critical' : null)}
        onRowClick={r => open(by === 'building' ? { tab: 'health', propertyId: r.propertyId, unitId: null } : { tab: 'health', unitId: r.unitId, propertyId: null })}
        empty={{ title: 'No reviews or finished reservations yet', icon: 'Star' }} />
    </>
  );
}
