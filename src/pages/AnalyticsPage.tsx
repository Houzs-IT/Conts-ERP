import { useMemo } from 'react';
import { color } from '../theme';
import { TONE, CHANNEL_META, cx } from '../lib/design-tokens';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import ChannelMark, { channelLabel } from '../components/ChannelMark';
import { useApi } from '../lib/useApi';
import { rm, monthLabel } from '../lib/format';
import type { BookingChannel, Tone } from '../lib/types';
import { useUrlState, usePhone, ListCard, SearchBox, FilterSelect, STICKY_HEAD } from './finance/listKit';

/* -----------------------------------------------------------------------------
 * Analytics / Revenue — `/performance/analytics` and `/finance/revenue`.
 *
 * A read-only performance view: one dataset per range, four metrics to look at
 * it through, the units at each end of the current metric, and where the money
 * comes from by channel. There are no mutating controls on this screen (it is
 * absent from BUTTONS.md and the routes.json actionCatalogue), so the only
 * interactive state is local: the metric and range switches. The range switch
 * re-reads `/api/analytics?range=`; with no backend in dev the read fails and we
 * fall back to the local dataset for the active range so the toggle still moves.
 *
 * Every delta carries a backend-supplied `tone`. The sign of the number never
 * decides the colour — an expected seasonal easing is neutral, not red (guide 12).
 * -------------------------------------------------------------------------- */

type Metric = 'revenue' | 'occupancy' | 'adr' | 'revpar';
type Range = '3m' | '12m' | 'ytd';

interface Point {
  period: string;
  revenue: number;     // integer sen
  occupancy: number;   // percent, e.g. 86.2
  adr: number;         // integer sen
  revpar: number;      // integer sen
  isCurrent?: boolean;
}
interface Delta { value: number; unit: 'percent' | 'points'; direction: 'up' | 'down' | 'flat'; tone: Tone; note?: string }
interface UnitRow {
  unitId: string; unitNumber: string; propertyName: string; buildingId?: string; nights?: number;
  occupancy: number; adr: number; revpar: number; revenue: number; rating: number | null;
}
interface ChannelShare { channel: BookingChannel; revenue: number; share: number } // share is percent
interface Totals { grossBookingValue: number; collectedRevenue: number; managementFees: number; netOwnerPayout: number }

interface AnalyticsPayload {
  generatedAt: string; currency: string; range: Range;
  points: Point[];
  deltas: Record<Metric, Delta>;
  totals: Totals;
  /** The whole window (older payloads lack it; the current month's point stands in). */
  summary?: { revenue: number; occupancy: number; adr: number; revpar: number; nights: number; listedUnits: number };
  units: UnitRow[];
  channelMix: ChannelShare[];
}

/* ------------------------------------------------------------------- data -- */
/* RevPAR is derived from ADR and occupancy so the three never drift apart. */

const pt = (period: string, revenue: number, occupancy: number, adr: number, isCurrent?: boolean): Point =>
  ({ period, revenue, occupancy, adr, revpar: Math.round((adr * occupancy) / 100), isCurrent });

const UNITS: UnitRow[] = [
  { unitId: 'u3', unitNumber: '#2207',    propertyName: 'Tribeca',            occupancy: 91.0, adr: 31800, revpar: 28900, revenue: 901000, rating: 4.95 },
  { unitId: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One',     occupancy: 94.1, adr: 28400, revpar: 26700, revenue: 812000, rating: 4.92 },
  { unitId: 'u5', unitNumber: '#B-32-05', propertyName: 'Trion KL',           occupancy: 85.6, adr: 25200, revpar: 21600, revenue: 702000, rating: 4.86 },
  { unitId: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', occupancy: 88.3, adr: 23100, revpar: 20400, revenue: 634000, rating: 4.88 },
  { unitId: 'u4', unitNumber: '#15-06',   propertyName: 'Scarletz KLCC',      occupancy: 79.4, adr: 26500, revpar: 21000, revenue: 588000, rating: 4.79 },
  { unitId: 'u7', unitNumber: '#A-09-02', propertyName: 'The Establishment',  occupancy: 81.2, adr: 24100, revpar: 19600, revenue: 512000, rating: 4.74 },
  { unitId: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites',     occupancy: 72.0, adr: 22800, revpar: 16400, revenue: 441000, rating: 4.71 },
  { unitId: 'u8', unitNumber: '#D-04-08', propertyName: 'Ceylonz Suites',     occupancy: 68.4, adr: 21400, revpar: 14600, revenue: 388000, rating: 4.66 },
];

const FLAT: Delta = { value: 0, unit: 'percent', direction: 'flat', tone: 'neutral' };
const EMPTY: AnalyticsPayload = {
  generatedAt: '', currency: 'MYR', range: '12m', points: [],
  deltas: { revenue: FLAT, occupancy: FLAT, adr: FLAT, revpar: FLAT },
  totals: { grossBookingValue: 0, collectedRevenue: 0, managementFees: 0, netOwnerPayout: 0 },
  units: [], channelMix: [],
};

const DATA: Record<Range, AnalyticsPayload> = {
  '3m': {
    generatedAt: '2026-09-16T06:06:00Z', currency: 'MYR', range: '3m',
    points: [
      pt('2026-07', 10800000, 82.4, 26200),
      pt('2026-08', 11600000, 84.1, 27100),
      pt('2026-09', 12200000, 86.2, 27600, true),
    ],
    // Revenue is down against the previous quarter — but a known post-peak easing,
    // so the backend keeps it neutral rather than red.
    deltas: {
      revenue:   { value: 3.1,  unit: 'percent', direction: 'down', tone: 'neutral', note: 'Expected easing after the mid-year peak.' },
      occupancy: { value: 3.8,  unit: 'points',  direction: 'up',   tone: 'success' },
      adr:       { value: 5.3,  unit: 'percent', direction: 'up',   tone: 'success' },
      revpar:    { value: 6.1,  unit: 'percent', direction: 'up',   tone: 'success' },
    },
    totals: { grossBookingValue: 42100000, collectedRevenue: 35800000, managementFees: 8950000, netOwnerPayout: 26850000 },
    units: UNITS,
    channelMix: [
      { channel: 'airbnb',      revenue: 5612000, share: 46 },
      { channel: 'booking_com', revenue: 2928000, share: 24 },
      { channel: 'direct',      revenue: 2196000, share: 18 },
      { channel: 'agoda',       revenue: 1464000, share: 12 },
    ],
  },
  '12m': {
    generatedAt: '2026-09-16T06:06:00Z', currency: 'MYR', range: '12m',
    points: [
      pt('2025-10', 9200000, 74.0, 24200), pt('2025-11', 9600000, 76.2, 24600), pt('2025-12', 11400000, 88.6, 26900),
      pt('2026-01', 9800000, 76.8, 24800), pt('2026-02', 10100000, 78.4, 25100), pt('2026-03', 10600000, 80.1, 25600),
      pt('2026-04', 9600000, 75.9, 24800), pt('2026-05', 10400000, 79.7, 25600), pt('2026-06', 11200000, 82.9, 26800),
      pt('2026-07', 10800000, 82.4, 26200), pt('2026-08', 11600000, 84.1, 27100), pt('2026-09', 12200000, 86.2, 27600, true),
    ],
    deltas: {
      revenue:   { value: 9.4,  unit: 'percent', direction: 'up',   tone: 'success' },
      occupancy: { value: 4.6,  unit: 'points',  direction: 'up',   tone: 'success' },
      adr:       { value: 2.1,  unit: 'percent', direction: 'up',   tone: 'neutral', note: 'Rate held steady while volume carried growth.' },
      revpar:    { value: 8.8,  unit: 'percent', direction: 'up',   tone: 'success' },
    },
    totals: { grossBookingValue: 162400000, collectedRevenue: 139200000, managementFees: 34800000, netOwnerPayout: 104400000 },
    units: UNITS,
    channelMix: [
      { channel: 'airbnb',      revenue: 63986000, share: 46 },
      { channel: 'booking_com', revenue: 33408000, share: 24 },
      { channel: 'direct',      revenue: 22272000, share: 16 },
      { channel: 'agoda',       revenue: 19488000, share: 14 },
    ],
  },
  'ytd': {
    generatedAt: '2026-09-16T06:06:00Z', currency: 'MYR', range: 'ytd',
    points: [
      pt('2026-01', 9800000, 76.8, 24800), pt('2026-02', 10100000, 78.4, 25100), pt('2026-03', 10600000, 80.1, 25600),
      pt('2026-04', 9600000, 75.9, 24800), pt('2026-05', 10400000, 79.7, 25600), pt('2026-06', 11200000, 82.9, 26800),
      pt('2026-07', 10800000, 82.4, 26200), pt('2026-08', 11600000, 84.1, 27100), pt('2026-09', 12200000, 86.2, 27600, true),
    ],
    deltas: {
      revenue:   { value: 12.6, unit: 'percent', direction: 'up',   tone: 'success' },
      occupancy: { value: 5.9,  unit: 'points',  direction: 'up',   tone: 'success' },
      adr:       { value: 3.4,  unit: 'percent', direction: 'up',   tone: 'success' },
      revpar:    { value: 10.2, unit: 'percent', direction: 'up',   tone: 'success' },
    },
    totals: { grossBookingValue: 123800000, collectedRevenue: 106100000, managementFees: 26525000, netOwnerPayout: 79575000 },
    units: UNITS,
    channelMix: [
      { channel: 'airbnb',      revenue: 48806000, share: 46 },
      { channel: 'booking_com', revenue: 25464000, share: 24 },
      { channel: 'direct',      revenue: 18037000, share: 17 },
      { channel: 'agoda',       revenue: 13793000, share: 13 },
    ],
  },
};

/* ---------------------------------------------------------------- metrics -- */

const compactMoney = (sen: number) => {
  const v = sen / 100;
  if (v >= 1_000_000) return 'RM ' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return 'RM ' + Math.round(v / 1_000) + 'k';
  return 'RM ' + Math.round(v);
};

/** Any row that carries the four metric figures — both a trend Point and a UnitRow do. */
type MetricBearing = { revenue: number; occupancy: number; adr: number; revpar: number };

const METRICS: Record<Metric, {
  label: string;
  pick: (p: MetricBearing) => number;
  full: (v: number) => string;   // headline / row value
  bar: (v: number) => string;    // compact label above a bar
}> = {
  revenue:   { label: 'Revenue',   pick: p => p.revenue,   full: v => rm(v, { cents: false }), bar: compactMoney },
  occupancy: { label: 'Occupancy', pick: p => p.occupancy, full: v => `${v.toFixed(1)}%`,      bar: v => `${v.toFixed(0)}%` },
  adr:       { label: 'ADR',       pick: p => p.adr,       full: v => rm(v, { cents: false }), bar: compactMoney },
  revpar:    { label: 'RevPAR',    pick: p => p.revpar,    full: v => rm(v, { cents: false }), bar: compactMoney },
};

const METRIC_ORDER: Metric[] = ['revenue', 'occupancy', 'adr', 'revpar'];

const RANGES: { key: Range; label: string }[] = [
  { key: '3m', label: '3 months' },
  { key: '12m', label: '12 months' },
  { key: 'ytd', label: 'Year to date' },
];

const RANGE_SUB: Record<Range, string> = {
  '3m': 'Last 3 months', '12m': 'Last 12 months', 'ytd': 'Year to date',
};

const ARROW: Record<'up' | 'down' | 'flat', string> = { up: '↑', down: '↓', flat: '→' };
const deltaText = (d: Delta) => d.note && d.value === 0 ? 'no earlier figures' : `${ARROW[d.direction]} ${d.value.toFixed(1)}${d.unit === 'points' ? ' pts' : '%'}`;

/* ------------------------------------------------------------------- page -- */

export default function AnalyticsPage() {
  // The same component answers two routes; read the hash so the revenue view
  // does not announce itself as "Analytics".
  const isRevenueView = typeof window !== 'undefined' && window.location.hash.replace(/^#/, '').startsWith('/finance/revenue');

  const url = useUrlState();
  const metric: Metric = (METRIC_ORDER as string[]).includes(url.get('metric')) ? url.get('metric') as Metric : 'revenue';
  const range: Range = RANGES.some(r => r.key === url.get('range')) ? url.get('range') as Range : '12m';
  const setMetric = (k: Metric) => url.set({ metric: k === 'revenue' ? null : k });
  const setRange = (k: Range) => url.set({ range: k === '12m' ? null : k });

  const q = useApi<AnalyticsPayload>(`/analytics?range=${range}`, DATA[range]);
  // No backend in dev: a range change fails to refetch, so fall back to the local
  // dataset for the active range and keep the toggle visibly live.
  const d = (q.error ? null : q.data) ?? (import.meta.env.DEV ? DATA[range] : EMPTY);

  const m = METRICS[metric];
  const delta = d.deltas[metric];
  const points = d.points;
  const current = points.find(p => p.isCurrent) ?? points[points.length - 1];
  const headline = d.summary ? m.pick(d.summary) : current ? m.pick(current) : 0;

  // Best and weakest are ranked by whichever metric is in focus, so the switch
  // drives all three panels at once.
  const ranked = [...d.units].sort((a, b) => m.pick(b) - m.pick(a));
  const best = ranked.slice(0, 4);
  const weakest = ranked.slice(-4).reverse();

  const loading = q.loading && !q.data;

  return (
    <>
      <PageHeader
        title={isRevenueView ? 'Revenue' : 'Analytics'}
        sub={`${RANGE_SUB[range]} · collected revenue, not gross booking value · Asia/Kuala Lumpur`}
      />

      {q.error && <StaleBanner message={`Showing the last figures we have. ${q.error}`} onRetry={q.reload} />}

      {/* Metric switch + trend chart --------------------------------------- */}
      <Card style={{ padding: 20 }}>
        <div className="flex flex-col gap-[18px]">
          <div className="flex items-start justify-between gap-[14px] flex-wrap">
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[30px] font-semibold tracking-[-0.01em] leading-[1.05]">{m.full(headline)}</span>
                <span className={cx('text-[14px] font-semibold', delta.note && delta.value === 0 ? 'text-muted-ink font-normal' : TONE[delta.tone].text)}>{deltaText(delta)}</span>
              </div>
              <span className="text-[12px] text-muted-ink [text-wrap:pretty]">
                {m.label}{d.summary ? `, ${RANGE_SUB[range].toLowerCase()}` : ' this period'} vs {range === 'ytd' ? 'the same period last year' : 'the prior window'}
              </span>
            </div>

            {/* Range toggle — re-reads /api/analytics?range= */}
            <div role="group" aria-label="Range" className="inline-flex border border-solid border-line rounded-control overflow-hidden flex-none">
              {RANGES.map((r, i) => {
                const on = r.key === range;
                return (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    aria-pressed={on}
                    className={cx(
                      'h-[30px] px-3 py-0 cursor-pointer [font:inherit] border-none whitespace-nowrap',
                      i === 0 ? '' : '[border-left:1px_solid_var(--color-line)]',
                      on ? 'bg-black text-white' : 'bg-card text-muted-ink',
                    )}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Metric segmented control */}
          <div role="group" aria-label="Metric" className="inline-flex self-start border border-solid border-line rounded-control overflow-hidden">
            {METRIC_ORDER.map((k, i) => {
              const on = k === metric;
              return (
                <button
                  key={k}
                  onClick={() => setMetric(k)}
                  aria-pressed={on}
                  className={cx(
                    'h-8 px-[14px] py-0 cursor-pointer [font:inherit] border-none whitespace-nowrap',
                    i === 0 ? '' : '[border-left:1px_solid_var(--color-line)]',
                    on ? 'bg-charcoal text-white' : 'bg-card text-muted-ink',
                  )}
                >
                  {METRICS[k].label}
                </button>
              );
            })}
          </div>

          {loading ? <div className="skeleton h-[210px] rounded-control" /> : (
            <TrendChart points={points} metric={metric} />
          )}

          {/* The four totals are distinct definitions and are never merged. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 pt-[14px] [border-top:1px_solid_var(--color-line-soft)]">
            <Total label="Gross booking value" value={rm(d.totals.grossBookingValue, { cents: false })} />
            <Total label="Collected revenue" value={rm(d.totals.collectedRevenue, { cents: false })} />
            <Total label="Management fees" value={rm(d.totals.managementFees, { cents: false })} />
            <Total label="Net owner payout" value={rm(d.totals.netOwnerPayout, { cents: false })} />
          </div>
          <span className="text-[11.5px] text-muted-ink -mt-2 [text-wrap:pretty]">
            Management fees and net owner payout come from owner statements generated for these months; a month with no statements adds nothing to them yet.
          </span>
        </div>
      </Card>

      {/* Best / weakest, ranked by the active metric ----------------------- */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
        {[{ key: 'best', title: 'Best performing', rows: best }, { key: 'weak', title: 'Weakest performing', rows: weakest }].map(g => (
          <Card key={g.key}>
            <CardHeader title={g.title} right={<span className="text-[12px] text-muted-ink">by {m.label.toLowerCase()}</span>} />
            {loading ? <TableSkeleton rows={4} cols={2} /> : g.rows.length === 0 ? (
              <div className="p-5 text-[13px] text-muted-ink">Not enough data for this period.</div>
            ) : g.rows.map((u, i) => (
              <div key={u.unitId} className="flex items-center gap-[14px] px-5 py-3 [border-top:1px_solid_var(--color-line-soft)]">
                <span className="text-[12px] font-semibold text-faint w-4 flex-none">{i + 1}</span>
                <div className="flex flex-col gap-px min-w-0 flex-1">
                  <span className="text-[13.5px] font-medium">{u.unitNumber}</span>
                  <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.propertyName}</span>
                </div>
                <div className="flex flex-col items-end gap-px flex-none">
                  <span className="text-[14px] font-semibold">{m.full(m.pick(u))}</span>
                  <span className="text-[11.5px] text-muted-ink">{u.occupancy.toFixed(1)}% occupancy</span>
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>

      <UnitTable units={d.units} metric={metric} loading={loading} />

      {/* Channel mix ------------------------------------------------------- */}
      <Card>
        <CardHeader title="Where revenue came from" right={<span className="text-[12px] text-muted-ink">share of collected revenue</span>} />
        <div className="flex flex-col gap-0">
          {loading ? <TableSkeleton rows={4} cols={2} /> : (d.channelMix ?? []).map(c => (
            <div key={c.channel} className="flex items-center gap-[14px] px-5 py-[13px] [border-top:1px_solid_var(--color-line-soft)]">
              <ChannelMark ch={c.channel} size={22} />
              <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-medium">{channelLabel(c.channel)}</span>
                  <span className="text-[13px] text-muted-ink">
                    <span className="font-semibold text-ink">{c.share}%</span>
                    {'  ·  '}{rm(c.revenue, { cents: false })}
                  </span>
                </div>
                {/* Channel colour is identity, not status — every row is also labelled. */}
                <div aria-hidden className="h-2 rounded-full overflow-hidden" style={{ background: CHANNEL_META[c.channel].tint }}>
                  <div className="h-full rounded-full" style={{ width: `${c.share}%`, background: CHANNEL_META[c.channel].hex }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- pieces -- */

type UnitSort = 'unit' | Metric;
const UNIT_COLS = 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)]';

/** Every listed unit for the window, sortable by any metric, with a building filter and a total row. */
function UnitTable({ units, metric, loading }: { units: UnitRow[]; metric: Metric; loading: boolean }) {
  const url = useUrlState();
  const phone = usePhone();
  const q = url.get('uq').toLowerCase();
  const building = url.get('ub');
  const raw = url.get('usort');
  const sortKey: UnitSort = (['unit', ...METRIC_ORDER] as string[]).includes(raw.replace(/^-/, '')) ? raw.replace(/^-/, '') as UnitSort : metric;
  // `usort` is a key, '-' in front for largest first; none means the focused metric, largest first.
  const asc = !!raw && !raw.startsWith('-');

  const buildings = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.buildingId ?? u.propertyName, u.propertyName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [units]);

  const rows = useMemo(() => {
    const list = units.filter(u =>
      (!building || (u.buildingId ?? u.propertyName) === building) &&
      (!q || `${u.propertyName} ${u.unitNumber}`.toLowerCase().includes(q)));
    list.sort((a, b) => {
      if (sortKey === 'unit') return `${a.propertyName} ${a.unitNumber}`.localeCompare(`${b.propertyName} ${b.unitNumber}`) * (asc ? 1 : -1);
      const m = METRICS[sortKey];
      return (m.pick(a) - m.pick(b)) * (asc ? 1 : -1) || a.unitNumber.localeCompare(b.unitNumber);
    });
    return list;
  }, [units, building, q, sortKey, asc]);

  const revenue = rows.reduce((n, u) => n + u.revenue, 0);
  const nights = rows.reduce((n, u) => n + (u.nights ?? 0), 0);
  const sortBy = (k: UnitSort) => url.set({ usort: sortKey === k ? (asc ? `-${k}` : k) : (k === 'unit' ? k : `-${k}`) });
  const Head = ({ k, label, right }: { k: UnitSort; label: string; right?: boolean }) => (
    <button onClick={() => sortBy(k)} aria-sort={sortKey === k ? (asc ? 'ascending' : 'descending') : undefined}
      className={cx('p-0 bg-transparent border-none cursor-pointer font-sans text-[12px] font-semibold inline-flex items-center gap-1', right ? 'justify-end' : '', sortKey === k ? 'text-ink' : 'text-muted-ink')}>
      {label}{sortKey === k && <span aria-hidden className="text-[10px]">{asc ? '▲' : '▼'}</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-[2px]">
          <span className="text-[15px] font-semibold">All units</span>
          <span className="text-[12px] text-muted-ink">{rows.length === units.length ? `${units.length} listed units` : `${rows.length} of ${units.length} listed units`}</span>
        </div>
        <div className="flex gap-2 flex-wrap flex-[1_1_420px] justify-end">
          <SearchBox className="flex-[1_1_200px] max-w-[300px]" label="Search units" placeholder="Search unit" value={url.get('uq')} onChange={v => url.set({ uq: v || null })} />
          <FilterSelect className="flex-[1_1_160px] max-w-[240px]" label="Building" all="All buildings" value={building} onChange={v => url.set({ ub: v || null })} options={buildings} />
        </div>
      </div>
      <ListCard>
        {loading ? <TableSkeleton rows={8} cols={phone ? 2 : 6} /> : rows.length === 0 ? (
          <div className="py-[36px] px-5 text-center text-[13px] text-muted-ink">No units match.</div>
        ) : phone ? (
          <div>
            {rows.map(u => (
              <div key={u.unitId} className="flex items-center gap-3 py-[10px] px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
                <div className="flex flex-col gap-[2px] min-w-0 flex-1">
                  <span className="text-[13.5px] font-medium truncate">{u.unitNumber}</span>
                  <span className="text-[11.5px] text-muted-ink truncate">{u.propertyName} · {u.occupancy.toFixed(1)}% occupied</span>
                </div>
                <div className="flex flex-col items-end gap-[2px] shrink-0">
                  <span className="text-[13.5px] font-semibold tabular-nums">{METRICS[metric].full(METRICS[metric].pick(u))}</span>
                  <span className="text-[11px] text-muted-ink">{METRICS[metric].label}</span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between py-3 px-4 bg-page text-[13px] font-semibold">
              <span>Total revenue</span><span className="tabular-nums">{rm(revenue, { cents: false })}</span>
            </div>
          </div>
        ) : (
          <div role="table" aria-label="Units">
            <div role="row" className={cx('grid', UNIT_COLS, 'gap-[14px] px-5 py-[9px]', STICKY_HEAD)}>
              <Head k="unit" label="Unit" />
              <Head k="revenue" label="Revenue" right />
              <Head k="occupancy" label="Occupancy" right />
              <Head k="adr" label="ADR" right />
              <Head k="revpar" label="RevPAR" right />
              <div className="text-right">Rating</div>
            </div>
            {rows.map(u => (
              <div role="row" key={u.unitId} className={cx('grid', UNIT_COLS, 'gap-[14px] items-center min-h-[46px] px-5 py-[6px] [border-bottom:1px_solid_var(--color-line-soft)] text-[13px]')}>
                <div className="flex flex-col gap-px min-w-0">
                  <span className="font-medium truncate" title={u.unitNumber}>{u.unitNumber}</span>
                  <span className="text-[11.5px] text-muted-ink truncate" title={u.propertyName}>{u.propertyName}</span>
                </div>
                <span className="text-right tabular-nums whitespace-nowrap">{rm(u.revenue, { cents: false })}</span>
                <span className="text-right tabular-nums whitespace-nowrap">{u.occupancy.toFixed(1)}%</span>
                <span className="text-right tabular-nums whitespace-nowrap">{rm(u.adr, { cents: false })}</span>
                <span className="text-right tabular-nums whitespace-nowrap">{rm(u.revpar, { cents: false })}</span>
                <span className="text-right tabular-nums text-muted-ink">{u.rating === null ? '—' : u.rating.toFixed(2)}</span>
              </div>
            ))}
            <div className={cx('grid', UNIT_COLS, 'gap-[14px] items-center px-5 py-[11px] bg-page text-[13px] font-semibold')}>
              <span>Total · {rows.length} units</span>
              <span className="text-right tabular-nums whitespace-nowrap">{rm(revenue, { cents: false })}</span>
              <span />
              <span className="text-right tabular-nums whitespace-nowrap" title="Revenue divided by booked nights">{nights ? rm(Math.round(revenue / nights), { cents: false }) : '—'}</span>
              <span /><span />
            </div>
          </div>
        )}
      </ListCard>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-[11px] text-muted-ink">{label}</span>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">{value}</span>
    </div>
  );
}

/** Dependency-free inline-SVG bar chart. Current period is gold; the rest
 *  charcoal. Value labels sit above each bar, month labels below, with faint
 *  gridlines for scale and a full tooltip on hover. A pixel-based viewBox with
 *  uniform scaling keeps text and corners crisp at any width. */
function TrendChart({ points, metric }: { points: Point[]; metric: Metric }) {
  const m = METRICS[metric];
  const values = points.map(m.pick);
  const max = Math.max(1, ...values);

  const W = 1000;
  const topPad = 26;                       // room for the value label
  const chartH = 140;                      // bar band
  const botPad = 34;                       // room for the month label
  const H = topPad + chartH + botPad;
  const baseline = topPad + chartH;
  const slot = W / points.length;
  const barW = Math.min(70, slot * 0.5);
  const many = points.length > 6;
  const gridAt = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`${m.label} by month`} style={{ width: '100%', height: 210, display: 'block' }}>
      {/* gridlines */}
      {gridAt.map(g => {
        const y = baseline - g * chartH;
        return <line key={g} x1={0} x2={W} y1={y} y2={y} stroke={color.borderMuted} strokeWidth={1} />;
      })}

      {points.map((p, i) => {
        const v = m.pick(p);
        const h = Math.max(3, (v / max) * chartH);
        const cx = slot * i + slot / 2;
        const x = cx - barW / 2;
        const y = baseline - h;
        return (
          <g key={p.period}>
            <title>{`${monthLabel(p.period)} · ${m.full(v)}${metric !== 'occupancy' ? ` · ${p.occupancy.toFixed(1)}% occupancy` : ''}`}</title>
            <rect x={x} y={y} width={barW} height={h} rx={5} ry={5}
              fill={p.isCurrent ? color.gold : color.charcoal} />
            {/* value label */}
            <text x={cx} y={y - 8} textAnchor="middle"
              style={{ fontSize: many ? 15 : 17, fontWeight: 600, fill: color.ink, fontFamily: 'var(--font-sans)' }}>
              {m.bar(v)}
            </text>
            {/* month label */}
            <text x={cx} y={baseline + 22} textAnchor="middle"
              style={{ fontSize: many ? 15 : 16, fill: color.textMuted, fontFamily: 'var(--font-sans)' }}>
              {monthLabel(p.period)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
