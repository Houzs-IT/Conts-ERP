import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import Icon from '../components/Icon';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { rm, percent, rating as fmtRating, todayMyt, monthLabel, plural, count, titleCase } from '../lib/format';
import { Button } from '../components/Button';
import { StatTile, Segmented } from '../components/Metric';
import { Select } from '../components/Select';
import { SearchBox } from './finance/listKit';
import type { Tone } from '../lib/types';

/* GET /api/portfolio/performance?period= — one row per listed unit for the period. The whole set is
 * at most a row per unit (about 25 KB for 139 units), so sorting, search and paging happen here and
 * the summary always covers every unit that matches, not just the page on screen. */
interface PortfolioRow {
  unitId: string; unitNumber: string; propertyId?: string; propertyName: string; ownerName: string;
  nights?: number; occupancy: number; adr: number; revpar: number; revenue: number; rating: number | null;
  exception: { label: string; tone: Tone } | null;
}
interface Payload { rows: PortfolioRow[]; units: number; buildings: number; days?: number; period?: string; generatedAt: string }

/* Dev-only sample (useApi drops it in a real build). */
const SAMPLE: PortfolioRow[] = [
  { unitId: 'u3', unitNumber: '#2207', propertyName: 'Tribeca', ownerName: 'Lim Chee Keong', nights: 27, occupancy: 91.0, adr: 31800, revpar: 28900, revenue: 901000, rating: 4.95, exception: null },
  { unitId: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', ownerName: 'Aina Zulkifli', nights: 28, occupancy: 94.1, adr: 28400, revpar: 26700, revenue: 812000, rating: 4.92, exception: null },
  { unitId: 'u5', unitNumber: '#B-32-05', propertyName: 'Trion KL', ownerName: 'Nurul Huda', nights: 26, occupancy: 85.6, adr: 25200, revpar: 21600, revenue: 702000, rating: 4.86, exception: null },
  { unitId: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', ownerName: 'Faridah Ismail', nights: 24, occupancy: 79.4, adr: 26500, revpar: 21000, revenue: 588000, rating: 4.79, exception: { label: 'Blocked', tone: 'warning' } },
  { unitId: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', ownerName: 'Tan Boon Huat', nights: 22, occupancy: 72.0, adr: 22800, revpar: 16400, revenue: 441000, rating: 4.71, exception: null },
];
const SAMPLE_PAYLOAD: Payload = { rows: SAMPLE, units: SAMPLE.length, buildings: 5, days: 30, generatedAt: '' };

/** This month, last month and this quarter, worked out from today in Malaysia. */
function periods() {
  const t = todayMyt();
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const q = Math.ceil(m / 3);
  return [
    // This month and this quarter stop at today (functions/api/portfolio/performance.ts); last month is complete.
    { key: t.slice(0, 7), label: 'This month', caption: `${monthLabel(t.slice(0, 7))} to date` },
    { key: last, label: 'Last month', caption: monthLabel(last) },
    { key: `${y}-q${q}`, label: 'Quarter to date', caption: `Q${q} ${y} to date` },
  ];
}

const NUM = 'tabular-nums whitespace-nowrap';

/* Building photography: drop public/brand/buildings/<slug>.jpg per building. Until one exists the
 * card falls back to the login hero, framed on a different part of it per card. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const FRAMES = ['30% 40%', '70% 55%', '50% 30%', '20% 70%', '80% 35%', '45% 65%'];
const occColour = (o: number) => o >= 90 ? 'var(--color-gold)' : o < 80 ? 'var(--color-warning-line)' : 'white';

interface BuildingCard { id: string; name: string; units: number; occupancy: number; adr: number; revenue: number; issues: number }

function BuildingTile({ b, i, money, onOpen }: { b: BuildingCard; i: number; money: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="group relative text-left rounded-card overflow-hidden border border-solid border-line bg-black min-h-[232px] flex flex-col justify-end cursor-pointer transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-[3px] hover:shadow-[var(--shadow-overlay)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]">
      <span aria-hidden className="absolute inset-0 bg-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.05]"
        style={{ backgroundImage: `url(/brand/buildings/${slug(b.name)}.jpg), url(/brand/login-hero.webp)`, backgroundPosition: FRAMES[i % FRAMES.length] }} />
      <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(21,21,21,0.20)_0%,rgba(21,21,21,0.55)_40%,rgba(21,21,21,0.94)_100%)] [&~*]:[text-shadow:0_1px_8px_rgba(0,0,0,0.6)]" />
      <span className="relative flex flex-col gap-3 p-[18px]">
        <span className="flex items-end justify-between gap-3">
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="text-[17px] leading-tight font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis">{b.name}</span>
            <span className="text-meta text-on-dark">{plural(b.units, 'unit')}{b.issues > 0 ? ` · ${b.issues} with exceptions` : ''}</span>
          </span>
          <span className="text-[26px] leading-none font-semibold tabular-nums" style={{ color: occColour(b.occupancy) }}>{percent(b.occupancy)}</span>
        </span>
        <span className="h-[4px] rounded-full bg-[rgba(255,255,255,0.16)] overflow-hidden">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, b.occupancy)}%`, background: occColour(b.occupancy) }} />
        </span>
        {money && (
          <span className="flex items-center justify-between gap-3 text-meta text-on-dark tabular-nums">
            <span>Avg nightly {rm(b.adr, { cents: false })}</span>
            <span className="font-semibold text-white">{rm(b.revenue, { cents: false })}</span>
          </span>
        )}
      </span>
    </button>
  );
}

export default function PortfolioPage() {
  const PERIODS = useMemo(periods, []);
  const navigate = useNavigate();
  // Period, search and building are in the address (the table adds its own sort, filters and page), so a shared
  // link opens the same view.
  const [params, setParams] = useSearchParams();
  const period = PERIODS.some(p => p.key === params.get('period')) ? params.get('period')! : PERIODS[0].key;
  const q = params.get('q') ?? '';
  const building = params.get('b') ?? 'all';
  const view = params.get('view') === 'units' ? 'units' : 'buildings';
  const set = (patch: Record<string, string | null>) => setParams(p => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') n.delete(k); else n.set(k, v); }
    n.delete('page');
    return n;
  }, { replace: true });

  const { data, loading, error, reload } = useApi<Payload>(`/portfolio/performance?period=${period}`, SAMPLE_PAYLOAD);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const caption = PERIODS.find(p => p.key === period)!.caption;

  const buildings = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const r of rows) {
      const id = r.propertyId ?? r.propertyName;
      const b = m.get(id) ?? { id, name: r.propertyName, n: 0 };
      b.n++; m.set(id, b);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Highest revenue first until someone picks a column to sort by.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => (building === 'all' || (r.propertyId ?? r.propertyName) === building)
      && (!needle || [r.unitNumber, r.propertyName, r.ownerName].some(s => s.toLowerCase().includes(needle))))
      .sort((a, b) => b.revenue - a.revenue || a.unitNumber.localeCompare(b.unitNumber, 'en', { numeric: true }));
  }, [rows, q, building]);

  // Summary over every unit the search and building match. Occupancy and ADR are weighted by nights (sold nights
  // over available nights, revenue over sold nights), not an average of per-unit percentages.
  const days = data?.days ?? 30;
  const n = filtered.length;
  const nights = filtered.reduce((s, r) => s + (r.nights ?? (r.occupancy * days) / 100), 0);
  const revenue = filtered.reduce((s, r) => s + r.revenue, 0);
  const occ = n ? (nights / (n * days)) * 100 : 0;
  const adr = nights ? Math.round(revenue / nights) : 0;
  const revpar = n ? Math.round(revenue / (n * days)) : 0;
  const money = rows.some(r => r.revenue > 0);
  const narrowed = building !== 'all' || !!q.trim();
  const withRating = rows.some(r => r.rating != null);
  const withException = rows.some(r => !!r.exception);

  // One card per building, weighted like the summary (sold nights over available nights).
  const buildingCards = useMemo<BuildingCard[]>(() => {
    const m = new Map<string, { id: string; name: string; units: number; nights: number; revenue: number; issues: number }>();
    for (const r of rows) {
      const id = r.propertyId ?? r.propertyName;
      const b = m.get(id) ?? { id, name: r.propertyName, units: 0, nights: 0, revenue: 0, issues: 0 };
      b.units++; b.nights += r.nights ?? (r.occupancy * days) / 100; b.revenue += r.revenue; if (r.exception) b.issues++;
      m.set(id, b);
    }
    return [...m.values()].map(b => ({
      id: b.id, name: b.name, units: b.units, issues: b.issues, revenue: b.revenue,
      occupancy: b.units ? (b.nights / (b.units * days)) * 100 : 0,
      adr: b.nights ? Math.round(b.revenue / b.nights) : 0,
    })).sort((a, b) => b.revenue - a.revenue || b.occupancy - a.occupancy);
  }, [rows, days]);

  const columns = useMemo<Column<PortfolioRow>[]>(() => [
    { key: 'unit', label: 'Unit', value: r => r.unitNumber, text: r => `${r.unitNumber} ${r.propertyName}`, exportValue: r => `${r.propertyName} ${r.unitNumber}`,
      hideable: false, width: 180, sub: r => r.propertyName,
      render: r => <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis block" title={r.unitNumber}>{r.unitNumber}</span> },
    { key: 'building', label: 'Building', value: r => r.propertyName, hidden: true, width: 150 },
    { key: 'owner', label: 'Owner', value: r => titleCase(r.ownerName), width: 150 },
    { key: 'nights', label: 'Nights', type: 'number', value: r => r.nights ?? null, hidden: true, width: 80 },
    { key: 'occupancy', label: 'Occupancy', type: 'number', value: r => r.occupancy, width: 100,
      render: r => <span className={NUM}>{percent(r.occupancy)}</span> },
    ...(money ? [
      { key: 'adr', label: 'Avg nightly price', type: 'money', value: r => r.adr, width: 100, render: r => <span className={NUM}>{rm(r.adr, { cents: false })}</span> },
      { key: 'revpar', label: 'Earnings per available night', type: 'money', value: r => r.revpar, width: 100, render: r => <span className={NUM}>{rm(r.revpar, { cents: false })}</span> },
      { key: 'revenue', label: 'Earnings', type: 'money', value: r => r.revenue, width: 120, phone: 'right',
        render: r => <span className={`${NUM} font-medium`}>{rm(r.revenue, { cents: false })}</span> },
    ] as Column<PortfolioRow>[] : []),
    ...(withRating ? [{ key: 'rating', label: 'Rating', type: 'number', value: r => r.rating, width: 80,
      render: r => <span className={NUM}>{r.rating != null ? fmtRating(r.rating) : '—'}</span> }] as Column<PortfolioRow>[] : []),
    ...(withException ? [{ key: 'exception', label: 'Exception', type: 'status', value: r => r.exception?.label ?? null, width: 130,
      status: r => r.exception, render: r => (r.exception ? <StatusBadge tone={r.exception.tone} label={r.exception.label} size="sm" /> : <span className="text-meta text-faint">None</span>) }] as Column<PortfolioRow>[] : []),
  ], [money, withRating, withException]);

  const tiles = [
    { label: narrowed ? 'Units shown' : 'Listed units', value: count(n) },
    { label: 'Occupancy', value: percent(occ) },
    { label: 'Avg nightly price', value: money ? rm(adr, { cents: false }) : '—' },
    { label: 'Earnings', value: money ? rm(revenue, { cents: false }) : '—' },
  ];

  return (
    <>
      <PageHeader
        title="Portfolio performance"
        sub={data ? `${plural(data.units ?? rows.length, 'listed unit')} · ${plural(data.buildings ?? buildings.length, 'building')} · ${caption}` : caption}
        actions={<div className="flex items-center gap-2 flex-wrap">
          <Segmented label="View" value={view} onChange={k => set({ view: k === 'buildings' ? null : k })}
            options={[{ key: 'buildings', label: 'Buildings' }, { key: 'units', label: 'Units' }]} />
          <Segmented label="Period" value={period} onChange={k => set({ period: k === PERIODS[0].key ? null : k })}
            options={PERIODS.map(p => ({ key: p.key, label: p.label }))} />
        </div>}
      />

      <div className="flex flex-wrap gap-3 sm:gap-4">
        {/* Until the figures arrive the tiles show a skeleton, not a zero that then jumps. Revenue leads as the dark tile. */}
        {[tiles[3], tiles[0], tiles[1], tiles[2]].map((t, i) => (
          <div key={t.label} className={i === 0 ? 'flex-[2_1_320px] min-w-0' : 'flex-[1_1_150px] min-w-0'}>
            <StatTile label={t.label} value={data ? t.value : '—'} loading={loading && !data} hero={i === 0} />
          </div>
        ))}
      </div>

      {view === 'buildings' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {loading && !data
            ? Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton block h-[232px] rounded-card" />)
            : buildingCards.map((b, i) => <BuildingTile key={b.id} b={b} i={i} money={money} onOpen={() => set({ view: 'units', b: b.id })} />)}
        </div>
      )}

      {view === 'units' && <DataTable<PortfolioRow>
        id="portfolio" phoneSort={false} columns={columns} rows={data ? filtered : null} rowKey={r => r.unitId}
        loading={loading} error={error} onRetry={reload} onRowClick={r => navigate(`/properties/units/${encodeURIComponent(r.unitId)}`)}
        noun={['unit', 'units']} exportName={`portfolio-${period}`} viewParams={['period', 'q', 'b', 'view']}
        filtered={narrowed} onClearFilters={() => set({ q: null, b: null })}
        empty={{ title: 'No listed units for this period.', icon: 'BarChart3', body: 'Units appear here once they are listed and have nights in the period.',
          action: { label: 'View all units', onClick: () => navigate('/properties/units') } }}
        header={<div className="pt-4 px-[22px] max-md:px-4 pb-1"><span className="text-heading font-semibold">Every listed unit, {caption}</span></div>}
        toolbar={<>
          <SearchBox value={q} onChange={v => set({ q: v })} placeholder="Search unit, building or owner" label="Search units"
            className="flex-1 min-w-[200px] max-w-[360px]" />
          <Select label="Building" value={building} onChange={v => set({ b: v === 'all' ? null : v })} className="w-full sm:w-[240px]"
            options={[{ value: 'all', label: 'All buildings' }, ...buildings.map(b => ({ value: b.id, label: `${b.name} (${b.n})` }))]} />
          {/* Phones have no column headers to tap, so sorting is a menu there. It writes the table's own sort. */}
          <Select label="Sort" value={params.get('sort') ?? ''} className="md:hidden"
            onChange={v => setParams(p => { const x = new URLSearchParams(p); if (v) x.set('sort', v); else x.delete('sort'); x.delete('page'); return x; }, { replace: true })}
            options={[
              { value: '', label: 'Earnings, high to low' },
              ...(money ? [{ value: 'revenue:asc', label: 'Earnings, low to high' }] : []),
              { value: 'occupancy:desc', label: 'Occupancy, high to low' },
              { value: 'occupancy:asc', label: 'Occupancy, low to high' },
              ...(money ? [{ value: 'adr:desc', label: 'Avg nightly price, high to low' }] : []),
              { value: 'unit:asc', label: 'Unit, A to Z' },
            ]} />
          {narrowed && (
            <Button variant="tertiary" size="sm" icon={<Icon name="RotateCcw" size="sm" />} onClick={() => set({ q: null, b: null })}>Clear filters</Button>
          )}
        </>}
        above={n > 0 && (
          <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-meta py-2 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="font-semibold text-ink">{narrowed ? plural(n, 'matching unit') : `All ${plural(n, 'unit')}`}</span>
            <span><span className="text-muted-ink">Occupancy </span><span className="font-semibold tabular-nums">{percent(occ)}</span></span>
            {money && <>
              <span><span className="text-muted-ink">Avg nightly price </span><span className="font-semibold tabular-nums">{rm(adr, { cents: false })}</span></span>
              <span><span className="text-muted-ink">Earnings per available night </span><span className="font-semibold tabular-nums">{rm(revpar, { cents: false })}</span></span>
              <span><span className="text-muted-ink">Earnings </span><span className="font-semibold tabular-nums">{rm(revenue, { cents: false })}</span></span>
            </>}
          </div>
        )}
      />}
    </>
  );
}
