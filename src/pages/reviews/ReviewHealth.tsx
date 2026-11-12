import { useState } from 'react';
import { Card } from '../../components/Card';
import { BarTrend, Segmented } from '../../components/Metric';
import { EmptyState } from '../../components/States';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import Icon from '../../components/Icon';
import { useApi } from '../../lib/useApi';
import { MONTHS, plural } from '../../lib/format';
import { cx, TONE } from '../../lib/design-tokens';
import { useUrlState, FilterSelect } from '../finance/listKit';
import { ListToolbar } from '../../components/ListToolbar';
import { AIRBNB_CATEGORIES, CATEGORY_FLAG_BELOW, categoryLabel } from '../../lib/reviewRules';
import { CategoryGrid, TagChips } from './reviewUi';
import type { PlaceRow } from './ReviewsOverview';

export type CategoryAverages = Record<string, { average: number; reviews: number }>;
interface TagCount { code: string; label: string; tone: 'positive' | 'negative' | 'other'; count: number }
interface Health {
  scope: { unitId: string | null; propertyId: string | null; label: string; months: number; from: string };
  categories: CategoryAverages; flagged: string[];
  trend: { month: string; reviews: number; average: number | null; categories: Record<string, number> }[];
  tags: { positive: TagCount[]; negative: TagCount[] };
  places: { id: string; by: 'unit' | 'building'; label: string; categories: CategoryAverages; flagged: string[]; topComplaints: TagCount[] }[];
}

/** Unit health: how guests rate one unit, one building or everything, category by category (out of 5, both
 *  channels), each month, with the categories under the flag line, the top compliments and complaints (Airbnb tags),
 *  and the units or buildings below it. A row or the unit link on a review opens it here. */
export function ReviewHealth() {
  const url = useUrlState();
  const unitId = url.get('unitId'), propertyId = url.get('propertyId');
  const months = ['6', '12', '24'].includes(url.get('months')) ? url.get('months') : '12';
  const [metric, setMetric] = useState<string>('overall');
  const q = new URLSearchParams(Object.entries({ unitId, propertyId: unitId ? '' : propertyId, months }).filter(([, v]) => v) as [string, string][]);
  const { data, error, reload } = useApi<Health>(`/reviews/health?${q}`);
  const places = useApi<{ data: PlaceRow[] }>('/reviews/units');
  const buildings = [...new Map((places.data?.data ?? []).filter(p => p.propertyId).map(p => [p.propertyId!, p.propertyName ?? ''])).entries()];
  const units = (places.data?.data ?? []).filter(p => !propertyId || p.propertyId === propertyId);

  const bars = (data?.trend ?? []).map((m, i, arr) => {
    const v = metric === 'overall' ? m.average : m.categories[metric] ?? null;
    const mo = Number(m.month.slice(5, 7));
    return {
      key: m.month, label: MONTHS[mo - 1], sub: i === 0 || mo === 1 ? m.month.slice(0, 4) : undefined,
      value: v ?? 0, display: v == null ? '–' : v.toFixed(2), current: i === arr.length - 1,
      title: `${MONTHS[mo - 1]} ${m.month.slice(0, 4)}: ${v == null ? 'no score' : `${v.toFixed(2)} out of 5`} · ${plural(m.reviews, 'review')}`,
    };
  });

  return (
    <>
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}
      <ListToolbar
        leading={<FilterSelect className="flex-[0_1_220px] min-w-[150px]" label="Unit" all="Every unit" value={unitId} onChange={v => url.set({ unitId: v || null })}
          options={units.filter(u => u.unitId).map(u => ({ value: u.unitId!, label: `${u.propertyName ?? ''} ${u.unitNumber ?? ''}`.trim() }))} />}
        filters={[{ key: 'building', label: 'Building', value: propertyId, onChange: v => url.set({ propertyId: v || null, unitId: null }), allLabel: 'All buildings',
          options: buildings.map(([id, name]) => ({ value: id, label: name })) }]}
        date={{ label: 'Months', value: months, def: '12', onChange: k => url.set({ months: k === '12' ? null : k }),
          presets: [{ value: '6', label: 'Last 6 months' }, { value: '12', label: 'Last 12 months' }, { value: '24', label: 'Last 24 months' }] }}
      />

      {!data ? <Card><TableSkeleton rows={4} cols={3} /></Card> : (
        <>
          <Card>
            <div className="px-5 sm:px-7 py-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-0.5">
                  <h2 className="m-0 text-heading font-semibold">{data.scope.label}</h2>
                  <span className="text-meta text-muted-ink">Every review so far · out of 5, Airbnb and Booking.com together</span>
                </div>
                {data.flagged.length > 0 && (
                  <span className={cx('inline-flex items-center gap-1.5 text-copy font-semibold', TONE.critical.text)}>
                    <Icon name="Flag" size="sm" /> {data.flagged.map(k => `${categoryLabel(k)} under ${CATEGORY_FLAG_BELOW[k]}`).join(', ')}
                  </span>
                )}
              </div>
              <CategoryGrid keys={AIRBNB_CATEGORIES} scores={data.categories} max={5} flag />
              {Object.keys(data.categories).some(k => !(AIRBNB_CATEGORIES as readonly string[]).includes(k)) && (
                <>
                  <span className="text-meta font-semibold text-muted-ink">Booking.com only</span>
                  <CategoryGrid keys={Object.keys(data.categories).filter(k => !(AIRBNB_CATEGORIES as readonly string[]).includes(k))} scores={data.categories} max={5} />
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="px-5 sm:px-7 py-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="m-0 text-copy font-semibold">By month</h3>
                <Segmented label="Score shown" value={metric} onChange={setMetric}
                  options={[{ key: 'overall', label: 'Overall' }, ...AIRBNB_CATEGORIES.map(k => ({ key: k as string, label: categoryLabel(k) }))]} />
              </div>
              {bars.length ? <BarTrend bars={bars} height={180} /> : <EmptyState bare icon="Star" title="No reviews in these months" />}
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <Card>
              <div className="px-5 py-4 flex flex-col gap-2.5">
                <h3 className="m-0 text-copy font-semibold">Top complaints</h3>
                {data.tags.negative.length ? <TagChips tags={data.tags.negative} counts /> : <span className="text-meta text-muted-ink">No complaint tags. Airbnb guests pick tags with their review.</span>}
              </div>
            </Card>
            <Card>
              <div className="px-5 py-4 flex flex-col gap-2.5">
                <h3 className="m-0 text-copy font-semibold">Top compliments</h3>
                {data.tags.positive.length ? <TagChips tags={data.tags.positive} counts /> : <span className="text-meta text-muted-ink">No compliment tags yet.</span>}
              </div>
            </Card>
          </div>

          {data.places.length > 0 && (
            <Card>
              <div className="px-5 sm:px-7 py-5 flex flex-col gap-1">
                <h3 className="m-0 text-copy font-semibold mb-2">{data.places[0].by === 'building' ? 'Buildings' : 'Units'}, lowest cleanliness first</h3>
                {data.places.map(p => (
                  <button key={p.id} type="button" onClick={() => url.set(p.by === 'building' ? { propertyId: p.id === 'none' ? null : p.id, unitId: null } : { unitId: p.id })}
                    className="flex items-center gap-3 py-2.5 bg-transparent border-none [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer text-left [font-family:inherit] text-ink">
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="text-copy font-medium truncate">{p.label}</span>
                      <span className="text-meta text-muted-ink truncate">{p.topComplaints.length ? `Complaints: ${p.topComplaints.map(t => `${t.label} (${t.count})`).join(', ')}` : 'No complaint tags'}</span>
                    </span>
                    <span className={cx('text-copy tabular-nums', p.flagged.includes('cleanliness') ? cx('font-semibold', TONE.critical.text) : '')}>
                      {p.categories.cleanliness ? `Cleanliness ${p.categories.cleanliness.average.toFixed(2)}` : 'No cleanliness score'}
                    </span>
                    <Icon name="ChevronRight" size="sm" />
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
