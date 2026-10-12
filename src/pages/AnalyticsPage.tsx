import { useMemo } from 'react';
import { BarTrend, Eyebrow, Figure, Segmented, TotalsRow } from '../components/Metric';
import { TONE, CHANNEL_META, cx } from '../lib/design-tokens';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import ChannelMark, { channelLabel } from '../components/ChannelMark';
import { useApi } from '../lib/useApi';
import { rm, rmCompact, monthLabel, plural, MONTHS } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import type { BookingChannel, Tone } from '../lib/types';
import { useUrlState, SearchBox } from './finance/listKit';
import { Select } from '../components/Select';
import { EmptyState } from '../components/States';

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

const compactMoney = rmCompact;

/** Any row that carries the four metric figures — both a trend Point and a UnitRow do. */
type MetricBearing = { revenue: number; occupancy: number; adr: number; revpar: number };

const METRICS: Record<Metric, {
  label: string;
  pick: (p: MetricBearing) => number;
  full: (v: number) => string;   // headline / row value
  bar: (v: number) => string;    // compact label above a bar
}> = {
  revenue:   { label: 'Earnings',   pick: p => p.revenue,   full: v => rm(v, { cents: false }), bar: compactMoney },
  occupancy: { label: 'Occupancy', pick: p => p.occupancy, full: v => `${v.toFixed(1)}%`,      bar: v => `${v.toFixed(0)}%` },
  adr:       { label: 'Avg nightly price',       pick: p => p.adr,       full: v => rm(v, { cents: false }), bar: compactMoney },
  revpar:    { label: 'Earnings per available night',    pick: p => p.revpar,    full: v => rm(v, { cents: false }), bar: compactMoney },
};

const METRIC_ORDER: Metric[] = ['revenue', 'occupancy', 'adr', 'revpar'];
/** Columns on the best / weakest lists. */
const RANK_COLS = ['revenue', 'occupancy', 'adr', 'rating'] as const;
const RANK_COL_LABEL: Record<(typeof RANK_COLS)[number], string> = { revenue: 'Earnings', occupancy: 'Occupancy', adr: 'Nightly', rating: 'Rating' };

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
  // Units with no booked nights in the window are not "weak performers", they were not selling (not
  // connected, blocked or new): they are counted separately rather than filling the weakest list.
  const idle = d.units.filter(u => (u.nights ?? (u.revenue > 0 ? 1 : 0)) === 0).length;
  const weakest = ranked.filter(u => (u.nights ?? (u.revenue > 0 ? 1 : 0)) > 0).slice(-4).reverse();

  const loading = q.loading && !q.data;
  const blank = d === EMPTY;
  const money = (sen: number) => blank ? '—' : rm(sen, { cents: false });

  return (
    <>
      <PageHeader
        title="Performance"
        sub={`${RANGE_SUB[range]} · guest totals, each reservation split by night into the months it covers`}
      />

      {q.error && <StaleBanner message={`Showing the last figures we have. ${q.error}`} onRetry={q.reload} />}

      {/* Metric switch + trend chart --------------------------------------- */}
      <Card style={{ padding: 0 }}>
        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-[14px] flex-wrap">
            <div className="flex flex-col gap-2 min-w-0">
              <Eyebrow>{m.label}{d.summary ? ` · ${RANGE_SUB[range].toLowerCase()}` : ' this period'}</Eyebrow>
              <div className="flex items-baseline gap-3 flex-wrap">
                <Figure value={blank ? '—' : m.full(headline)} className="text-[34px] sm:text-[44px] font-medium tracking-[-0.03em] leading-none" />
                <span className={cx('text-copy font-semibold', delta.note && delta.value === 0 ? 'text-muted-ink font-normal' : TONE[delta.tone].text)}>{blank ? '' : deltaText(delta)}</span>
              </div>
              <span className="text-meta text-muted-ink [text-wrap:pretty]">
                vs {range === 'ytd' ? 'the same period last year' : 'the prior window'}
              </span>
            </div>

            {/* Range toggle — re-reads /api/analytics?range= */}
            <Segmented label="Range" options={RANGES} value={range} onChange={setRange} />
          </div>

          <Segmented label="Metric" options={METRIC_ORDER.map(k => ({ key: k, label: METRICS[k].label }))} value={metric} onChange={setMetric} className="self-start" />

          {loading ? <div className="skeleton h-[230px] rounded-control" /> : (
            <BarTrend height={200} bars={points.map(p => {
              const v = m.pick(p);
              return {
                key: p.period,
                label: points.length > 6 ? MONTHS[Number(p.period.slice(5, 7)) - 1] : monthLabel(p.period),
                sub: points.length > 6 && (p === points[0] || p.period.endsWith('-01')) ? p.period.slice(0, 4) : undefined,
                value: v,
                display: m.bar(v).replace('RM ', ''),
                title: `${monthLabel(p.period)} · ${m.full(v)}${metric !== 'occupancy' ? ` · ${p.occupancy.toFixed(1)}% occupancy` : ''}`,
                current: p.isCurrent,
              };
            })} />
          )}

          {/* The four totals are distinct definitions and are never merged. */}
          <TotalsRow items={[
            { label: 'Guest total', value: money(d.totals.grossBookingValue) },
            { label: 'Earnings', value: money(d.totals.collectedRevenue) },
            { label: 'Operator share', value: money(d.totals.managementFees) },
            { label: 'Net Payout to Owner', value: money(d.totals.netOwnerPayout) },
          ]} />
          <span className="text-meta text-muted-ink -mt-2 [text-wrap:pretty]">
            Operator share and Net Payout to Owner come from the owner statements for these months. A month with no statements adds nothing yet.
          </span>
        </div>
      </Card>

      {/* Best / weakest, ranked by the active metric ----------------------- */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
        {[{ key: 'best', title: 'Best performing', rows: best }, { key: 'weak', title: 'Weakest performing', rows: weakest }].map(g => (
          <Card key={g.key}>
            <CardHeader title={g.title} right={<span className="text-meta text-muted-ink">by {m.label.toLowerCase()}</span>} />
            {!loading && g.rows.length > 0 && (
              <div className="max-md:hidden grid grid-cols-[24px_minmax(0,1fr)_repeat(4,74px)] gap-[14px] items-center px-5 pb-2 text-caption font-semibold text-muted-ink">
                <span /><span>Unit</span>
                {RANK_COLS.map(k => <span key={k} className={cx('text-right', k === metric && 'text-gold-ink')}>{RANK_COL_LABEL[k]}</span>)}
              </div>
            )}
            {g.key === 'weak' && idle > 0 && <div className="px-5 pb-2 -mt-1 text-meta text-muted-ink">{plural(idle, 'listed unit')} had no booked nights in this window and {idle === 1 ? 'is' : 'are'} not ranked.</div>}
            {loading ? <TableSkeleton rows={4} cols={2} /> : g.rows.length === 0 ? (
              <EmptyState bare title="Not enough data for this period." body="Units appear here once they have booked nights in the window." />
            ) : g.rows.map((u, i) => (
              <div key={u.unitId} className="flex md:grid md:grid-cols-[24px_minmax(0,1fr)_repeat(4,74px)] items-center gap-[14px] px-5 py-3 [border-top:1px_solid_var(--color-line-soft)]">
                <span className={cx('w-6 h-6 rounded-full grid place-items-center text-caption font-semibold flex-none tabular-nums', g.key === 'best' && i === 0 ? 'bg-gold-tint text-gold-ink' : 'bg-muted text-muted-ink')}>{i + 1}</span>
                <div className="flex flex-col gap-px min-w-0 flex-1">
                  <span className="text-copy font-medium">{u.unitNumber}</span>
                  <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.propertyName}</span>
                </div>
                <div className="md:hidden flex flex-col items-end gap-px flex-none">
                  <span className="text-copy font-semibold tabular-nums">{m.full(m.pick(u))}</span>
                  <span className="text-meta text-muted-ink">{u.occupancy.toFixed(1)}% occupancy</span>
                </div>
                {RANK_COLS.map(k => (
                  <span key={k} className={cx('max-md:hidden text-right tabular-nums text-copy', k === metric ? 'font-semibold text-ink' : 'text-muted-ink')}>
                    {k === 'rating' ? (u.rating == null ? '—' : u.rating.toFixed(2)) : METRICS[k].full(METRICS[k].pick(u))}
                  </span>
                ))}
              </div>
            ))}
          </Card>
        ))}
      </div>

      <UnitTable units={d.units} metric={metric} loading={loading} range={range} />

      {/* Channel mix ------------------------------------------------------- */}
      <Card>
        <CardHeader title="Where earnings came from" right={<span className="text-meta text-muted-ink">share of guest total</span>} />
        <div className="flex flex-col gap-0">
          {loading ? <TableSkeleton rows={4} cols={2} /> : (d.channelMix ?? []).map(c => (
            <div key={c.channel} className="flex items-center gap-[14px] px-5 py-[13px] [border-top:1px_solid_var(--color-line-soft)]">
              <ChannelMark ch={c.channel} size={22} />
              <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-copy font-medium">{channelLabel(c.channel)}</span>
                  <span className="text-copy text-muted-ink">
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

/** Every listed unit for the window, sortable and filterable by any column, with a building filter and totals. */
function UnitTable({ units, metric, loading, range }: { units: UnitRow[]; metric: Metric; loading: boolean; range: Range }) {
  const url = useUrlState();
  const q = url.get('uq').toLowerCase();
  const building = url.get('ub');

  const buildings = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.buildingId ?? u.propertyName, u.propertyName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [units]);

  // Largest first by the metric in focus until someone sorts by a column.
  const rows = useMemo(() => {
    const m = METRICS[metric];
    return units.filter(u =>
      (!building || (u.buildingId ?? u.propertyName) === building) &&
      (!q || `${u.propertyName} ${u.unitNumber}`.toLowerCase().includes(q)))
      .sort((a, b) => m.pick(b) - m.pick(a) || a.unitNumber.localeCompare(b.unitNumber));
  }, [units, building, q, metric]);

  const revenue = rows.reduce((n, u) => n + u.revenue, 0);
  const nights = rows.reduce((n, u) => n + (u.nights ?? 0), 0);
  const narrowed = !!q || !!building;
  const NUM = 'tabular-nums whitespace-nowrap';

  const columns = useMemo<Column<UnitRow>[]>(() => [
    { key: 'unit', label: 'Unit', value: u => u.unitNumber, text: u => `${u.propertyName} ${u.unitNumber}`, exportValue: u => `${u.propertyName} ${u.unitNumber}`,
      hideable: false, width: 180, sub: u => u.propertyName,
      render: u => <span className="font-medium truncate block" title={u.unitNumber}>{u.unitNumber}</span> },
    { key: 'building', label: 'Building', value: u => u.propertyName, hidden: true, width: 150 },
    { key: 'revenue', label: 'Earnings', type: 'money', value: u => u.revenue, width: 120, render: u => <span className={NUM}>{rm(u.revenue, { cents: false })}</span> },
    { key: 'nights', label: 'Booked nights', type: 'number', value: u => u.nights ?? null, hidden: true, width: 100 },
    { key: 'occupancy', label: 'Occupancy', type: 'number', value: u => u.occupancy, width: 100, render: u => <span className={NUM}>{u.occupancy.toFixed(1)}%</span> },
    { key: 'adr', label: 'Avg nightly price', type: 'money', value: u => u.adr, width: 100, render: u => <span className={NUM}>{rm(u.adr, { cents: false })}</span> },
    { key: 'revpar', label: 'Earnings per available night', type: 'money', value: u => u.revpar, width: 100, render: u => <span className={NUM}>{rm(u.revpar, { cents: false })}</span> },
    { key: 'rating', label: 'Rating', type: 'number', value: u => u.rating, width: 80,
      render: u => <span className="tabular-nums text-muted-ink">{u.rating === null ? '—' : u.rating.toFixed(2)}</span> },
  ], []);

  return (
    <DataTable<UnitRow>
      id="analytics.units" columns={columns} rows={loading ? null : rows} rowKey={u => u.unitId}
      noun={['unit', 'units']} exportName={`performance-${range}`}
      viewParams={['uq', 'ub']} filtered={narrowed} onClearFilters={() => url.set({ uq: null, ub: null })}
      empty={{ title: 'No listed units in this window.', icon: 'BarChart3' }}
      header={
        <div className="flex flex-col gap-[2px] pt-4 pb-1 px-[22px] max-md:px-4">
          <span className="text-heading font-semibold">All units</span>
          <span className="text-meta text-muted-ink">{loading ? '' : rows.length === units.length ? plural(units.length, 'listed unit') : `${rows.length} of ${plural(units.length, 'listed unit')}`}</span>
        </div>
      }
      toolbar={<>
        <SearchBox className="flex-[1_1_200px] max-w-[300px]" label="Search units" placeholder="Search unit" value={url.get('uq')} onChange={v => url.set({ uq: v || null, page: null })} />
        <Select className="flex-[1_1_160px] max-w-[240px]" label="Building" value={building} onChange={v => url.set({ ub: v || null, page: null })} options={[{ value: '', label: 'All buildings' }, ...buildings]} />
      </>}
      above={rows.length > 0 && (
        <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-meta py-2 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
          <span className="font-semibold text-ink" title="Listed units only; the earnings figure at the top also counts units no longer listed.">Total · {plural(rows.length, 'listed unit')}</span>
          <span><span className="text-muted-ink">Earnings </span><span className="font-semibold tabular-nums">{rm(revenue, { cents: false })}</span></span>
          <span title="Earnings divided by booked nights"><span className="text-muted-ink">Avg nightly price </span><span className="font-semibold tabular-nums">{nights ? rm(Math.round(revenue / nights), { cents: false }) : '—'}</span></span>
        </div>
      )}
      renderCard={u => (
        <span className="flex items-center gap-3">
          <span className="flex flex-col gap-[2px] min-w-0 flex-1">
            <span className="text-copy font-medium truncate">{u.unitNumber}</span>
            <span className="text-meta text-muted-ink truncate">{u.propertyName} · {u.occupancy.toFixed(1)}% occupied</span>
          </span>
          <span className="flex flex-col items-end gap-[2px] shrink-0">
            <span className="text-copy font-semibold tabular-nums">{METRICS[metric].full(METRICS[metric].pick(u))}</span>
            <span className="text-caption text-muted-ink">{METRICS[metric].label}</span>
          </span>
        </span>
      )}
    />
  );
}
