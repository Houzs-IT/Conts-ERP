import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm, percent, rating as fmtRating } from '../lib/format';
import { cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/* GET /api/portfolio/performance?period= — rows are every unit for the period.
 * Shape mirrors api.md §2 and the DashboardPage preview: exception (never
 * readiness) carries its own server tone, so colour never stands alone. */
interface PortfolioRow {
  unitId: string; unitNumber: string; propertyName: string; ownerName: string;
  occupancy: number; adr: number; revpar: number; revenue: number; rating: number | null;
  exception: { label: string; tone: Tone } | null;
}
interface Payload { rows: PortfolioRow[]; units: number; buildings: number; generatedAt: string }

/* Dev has no backend. A base set (this month) plus scaled variants per period so
 * the period selector and the summary tiles visibly move without a live read. */
const BASE: PortfolioRow[] = [
  { unitId: 'u3', unitNumber: '#2207', propertyName: 'Tribeca', ownerName: 'Lim Chee Keong', occupancy: 91.0, adr: 31800, revpar: 28900, revenue: 901000, rating: 4.95, exception: null },
  { unitId: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', ownerName: 'Aina Zulkifli', occupancy: 94.1, adr: 28400, revpar: 26700, revenue: 812000, rating: 4.92, exception: null },
  { unitId: 'u5', unitNumber: '#B-32-05', propertyName: 'Trion KL', ownerName: 'Nurul Huda', occupancy: 85.6, adr: 25200, revpar: 21600, revenue: 702000, rating: 4.86, exception: null },
  { unitId: 'u7', unitNumber: '#A-21-02', propertyName: 'The Establishment', ownerName: 'Nur Aisyah', occupancy: 85.2, adr: 24200, revpar: 20600, revenue: 672000, rating: 4.84, exception: null },
  { unitId: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', ownerName: 'Priya Sundaram', occupancy: 88.3, adr: 23100, revpar: 20400, revenue: 634000, rating: 4.88, exception: null },
  { unitId: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', ownerName: 'Faridah Ismail', occupancy: 79.4, adr: 26500, revpar: 21000, revenue: 588000, rating: 4.79, exception: { label: 'Pricing review', tone: 'warning' } },
  { unitId: 'u8', unitNumber: '#12-09', propertyName: 'Vista Jaya One', ownerName: 'Wong Mei Ling', occupancy: 82.7, adr: 22400, revpar: 18500, revenue: 512000, rating: 4.81, exception: null },
  { unitId: 'u9', unitNumber: '#3305', propertyName: 'Tribeca', ownerName: 'Rajesh Kumar', occupancy: 68.5, adr: 30100, revpar: 20600, revenue: 486000, rating: 4.66, exception: { label: 'Occupancy below target', tone: 'warning' } },
  { unitId: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', ownerName: 'Tan Boon Huat', occupancy: 72.0, adr: 22800, revpar: 16400, revenue: 441000, rating: 4.71, exception: { label: 'Blocked', tone: 'critical' } },
];

const scale = (rows: PortfolioRow[], occ: number, money: number): PortfolioRow[] =>
  rows.map(r => ({
    ...r,
    occupancy: Math.min(99.9, Math.round(r.occupancy * occ * 10) / 10),
    adr: Math.round(r.adr * (0.98 + (money - 1) * 0.04)),
    revpar: Math.round(r.revpar * money),
    revenue: Math.round(r.revenue * money),
  }));

interface Period { key: string; label: string; caption: string; rows: PortfolioRow[] }
const PERIODS: Period[] = [
  { key: '2026-09', label: 'This month', caption: 'Sep 2026', rows: BASE },
  { key: '2026-08', label: 'Last month', caption: 'Aug 2026', rows: scale(BASE, 0.96, 0.93) },
  { key: '2026-q3', label: 'Quarter to date', caption: 'Q3 2026', rows: scale(BASE, 0.99, 2.9) },
];
const periodFor = (key: string) => PERIODS.find(p => p.key === key) ?? PERIODS[0];

const local = (key: string): Payload => {
  const rows = periodFor(key).rows;
  return { rows, units: rows.length, buildings: new Set(rows.map(r => r.propertyName)).size, generatedAt: '2026-09-16T06:06:00Z' };
};

type SortKey = 'unit' | 'occupancy' | 'adr' | 'revpar' | 'revenue' | 'rating';
type Dir = 'asc' | 'desc';
const NUMERIC = (r: PortfolioRow, k: SortKey): number => {
  switch (k) {
    case 'occupancy': return r.occupancy;
    case 'adr': return r.adr;
    case 'revpar': return r.revpar;
    case 'revenue': return r.revenue;
    case 'rating': return r.rating ?? -1;
    default: return 0;
  }
};

/* Shared 8-track grid template (unit, owner, occupancy, adr, revpar, revenue,
 * rating, exception). Kept as one arbitrary Tailwind class so header and rows
 * stay in lockstep; the literal lives here verbatim so Tailwind can extract it. */
const COLS = 'grid-cols-[minmax(180px,1.8fr)_minmax(120px,1.1fr)_minmax(96px,0.9fr)_minmax(90px,0.9fr)_minmax(92px,0.9fr)_minmax(104px,1fr)_minmax(78px,0.8fr)_minmax(120px,1.1fr)]';

export default function PortfolioPage() {
  const [period, setPeriod] = useState('2026-09');
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'revenue', dir: 'desc' });

  // Path carries the period so a live backend re-reads per selection. In dev the
  // read fails, so we prefer the local dataset for the active period (the same
  // pattern DashboardPage uses for its trend range) — the toggle stays honest.
  const { data, loading, error, reload } = useApi<Payload>(`/portfolio/performance?period=${period}`, local('2026-09'));
  const payload = (error ? null : data) ?? local(period);

  const sorted = useMemo(() => {
    const rows = [...payload.rows];
    const factor = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => sort.key === 'unit'
      ? factor * a.unitNumber.localeCompare(b.unitNumber, 'en', { numeric: true })
      : factor * (NUMERIC(a, sort.key) - NUMERIC(b, sort.key)));
    return rows;
  }, [payload.rows, sort]);

  const units = payload.rows.length;
  const buildings = new Set(payload.rows.map(r => r.propertyName)).size;
  const avgOcc = units ? payload.rows.reduce((s, r) => s + r.occupancy, 0) / units : 0;
  const avgAdr = units ? Math.round(payload.rows.reduce((s, r) => s + r.adr, 0) / units) : 0;
  const totalRevenue = payload.rows.reduce((s, r) => s + r.revenue, 0);
  const caption = periodFor(period).caption;

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: key === 'unit' ? 'asc' : 'desc' });
  }

  const tiles = [
    { label: 'Units', value: String(units) },
    { label: 'Average occupancy', value: percent(avgOcc) },
    { label: 'Average ADR', value: rm(avgAdr, { cents: false }) },
    { label: 'Total revenue', value: rm(totalRevenue, { cents: false }) },
  ];

  return (
    <>
      <PageHeader
        title="Portfolio performance"
        sub={`${units} units · ${buildings} buildings · ${caption} to date`}
        right={
          <div role="group" aria-label="Period" className="inline-flex border border-solid border-line rounded-control overflow-hidden flex-none">
            {PERIODS.map((p, i) => {
              const on = p.key === period;
              return (
                <button key={p.key} onClick={() => setPeriod(p.key)} aria-pressed={on}
                  className={cx(
                    'h-8 px-[13px] py-0 cursor-pointer [font:inherit] whitespace-nowrap',
                    '[border-top:0] [border-right:0] [border-bottom:0]',
                    i === 0 ? '[border-left:0]' : '[border-left:1px_solid_var(--color-line)]',
                    on ? 'bg-black text-white' : 'bg-card text-muted-ink',
                  )}>
                  {p.label}
                </button>
              );
            })}
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      {/* Summary tiles */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[14px]">
        {tiles.map(t => (
          <div key={t.label} className="bg-card border border-solid border-line rounded-card p-[18px] flex flex-col gap-2">
            <div className="text-[12px] text-muted-ink">{t.label}</div>
            <div className="text-[26px] leading-[1.15] font-semibold tracking-[-0.01em]">{t.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <div className="pt-4 px-5 pb-3 flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-[16px] font-semibold">Every unit, {caption} to date</span>
          <span className="text-[12px] text-muted-ink">Sorted by {SORT_LABEL[sort.key]}, {sort.dir === 'desc' ? 'high to low' : 'low to high'}</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1040px]">
            <div className={cx(COLS, 'grid gap-[14px] py-[9px] px-[22px] bg-muted [border-top:1px_solid_var(--color-line)] [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
              <SortHead label="Unit" col="unit" sort={sort} onSort={toggleSort} />
              <div>Owner</div>
              <SortHead label="Occupancy" col="occupancy" align="right" sort={sort} onSort={toggleSort} />
              <SortHead label="ADR" col="adr" align="right" sort={sort} onSort={toggleSort} />
              <SortHead label="RevPAR" col="revpar" align="right" sort={sort} onSort={toggleSort} />
              <SortHead label="Revenue" col="revenue" align="right" sort={sort} onSort={toggleSort} />
              <SortHead label="Rating" col="rating" align="right" sort={sort} onSort={toggleSort} />
              <div>Exception</div>
            </div>

            {loading && payload.rows.length === 0 ? <TableSkeleton rows={8} cols={8} /> : sorted.length === 0 ? (
              <EmptyState />
            ) : sorted.map(u => (
              <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}`}
                className={cx(COLS, 'grid gap-[14px] items-center min-h-[52px] py-2 px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit hover:text-inherit')}>
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-[13.5px] font-medium">{u.unitNumber}</span>
                  <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.propertyName}</span>
                </div>
                <span className="text-[12.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.ownerName}</span>
                <span className="text-[13px] text-right">{percent(u.occupancy)}</span>
                <span className="text-[13px] text-right">{rm(u.adr, { cents: false })}</span>
                <span className="text-[13px] text-right">{rm(u.revpar, { cents: false })}</span>
                <span className="text-[13px] text-right font-medium">{rm(u.revenue, { cents: false })}</span>
                <span className="text-[13px] text-right">{u.rating != null ? fmtRating(u.rating) : '—'}</span>
                <div>{u.exception ? <Badge tone={u.exception.tone} label={u.exception.label} size="sm" /> : <span className="text-[12px] text-faint">None</span>}</div>
              </a>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}

const SORT_LABEL: Record<SortKey, string> = {
  unit: 'unit', occupancy: 'occupancy', adr: 'ADR', revpar: 'RevPAR', revenue: 'revenue', rating: 'rating',
};

/** A sortable column header. The active column carries the gold selection ink
 *  (brand/selection only — never a status tone) and a direction caret. */
function SortHead({ label, col, align = 'left', sort, onSort }: {
  label: string; col: SortKey; align?: 'left' | 'right';
  sort: { key: SortKey; dir: Dir }; onSort: (k: SortKey) => void;
}) {
  const active = sort.key === col;
  return (
    <button onClick={() => onSort(col)} aria-label={`Sort by ${label}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cx(
        'flex items-center gap-[3px]',
        align === 'right' ? 'justify-end' : 'justify-start',
        'bg-transparent [border:none] p-0 cursor-pointer [font:inherit] text-[12px] font-semibold',
        active ? 'text-gold-ink' : 'text-muted-ink',
      )}>
      <span>{label}</span>
      <Icon name={active ? (sort.dir === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'ChevronsUpDown'} size="sm"
        style={{ opacity: active ? 1 : 0.4 }} />
    </button>
  );
}

function EmptyState() {
  return (
    <div className="py-12 px-[22px] flex flex-col items-center gap-3 text-center">
      <span className="text-muted-ink"><Icon name="BarChart3" /></span>
      <div className="text-[14px] text-muted-ink max-w-[360px]">No units to show for this period.</div>
      <a href="#/properties/units" className="text-[12px] font-semibold text-gold-ink! no-underline">{'View all units →'}</a>
    </div>
  );
}
