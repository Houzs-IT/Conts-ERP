import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { ListPager } from '../components/ListPager';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm, percent, rating as fmtRating, todayMyt, monthLabel, plural, count, titleCase } from '../lib/format';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { EmptyState } from '../components/States';
import { Chip, SearchBox } from './finance/listKit';
import { cx } from '../lib/design-tokens';
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
  { unitId: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', ownerName: 'Faridah Ismail', nights: 24, occupancy: 79.4, adr: 26500, revpar: 21000, revenue: 588000, rating: 4.79, exception: { label: 'Off sale', tone: 'warning' } },
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
    { key: t.slice(0, 7), label: 'This month', caption: `${monthLabel(t.slice(0, 7))} to date` },
    { key: last, label: 'Last month', caption: monthLabel(last) },
    { key: `${y}-q${q}`, label: 'Quarter to date', caption: `Q${q} ${y} to date` },
  ];
}

type SortKey = 'unit' | 'occupancy' | 'adr' | 'revpar' | 'revenue' | 'rating';
type Dir = 'asc' | 'desc';
const SORTS: SortKey[] = ['unit', 'occupancy', 'adr', 'revpar', 'revenue', 'rating'];
const SORT_LABEL: Record<SortKey, string> = { unit: 'unit', occupancy: 'occupancy', adr: 'ADR', revpar: 'RevPAR', revenue: 'revenue', rating: 'rating' };
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
const PAGE_SIZE = 25;

/* Unit, owner, occupancy, ADR, RevPAR, revenue, then rating and exception only when some unit has one.
 * Built once per render so header, rows and the totals row stay in lockstep. */
const colTemplate = (withRating: boolean, withException: boolean) => [
  'minmax(180px,1.8fr)', 'minmax(120px,1.1fr)', 'minmax(92px,0.8fr)', 'minmax(88px,0.8fr)', 'minmax(88px,0.8fr)', 'minmax(110px,1fr)',
  ...(withRating ? ['minmax(64px,0.6fr)'] : []), ...(withException ? ['minmax(120px,1.1fr)'] : []),
].join(' ');
const NUM = 'text-right [font-variant-numeric:tabular-nums] whitespace-nowrap';

export default function PortfolioPage() {
  const PERIODS = useMemo(periods, []);
  // Period, sort, search, building and page are all in the address, so a shared link opens the same view.
  const [params, setParams] = useSearchParams();
  const period = PERIODS.some(p => p.key === params.get('period')) ? params.get('period')! : PERIODS[0].key;
  const sortKey: SortKey = SORTS.includes(params.get('sort') as SortKey) ? (params.get('sort') as SortKey) : 'revenue';
  const dir: Dir = params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : sortKey === 'unit' ? 'asc' : 'desc';
  const q = params.get('q') ?? '';
  const building = params.get('b') ?? 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const set = (patch: Record<string, string | null>, keepPage = false) => setParams(p => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') n.delete(k); else n.set(k, v); }
    if (!keepPage) n.delete('page');
    return n;
  }, { replace: true });

  const { data, loading, error, reload } = useApi<Payload>(`/portfolio/performance?period=${period}`, SAMPLE_PAYLOAD);
  const rows = data?.rows ?? [];
  const caption = PERIODS.find(p => p.key === period)!.caption;
  const stale = loading && !!data;

  const buildings = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const r of rows) {
      const id = r.propertyId ?? r.propertyName;
      const b = m.get(id) ?? { id, name: r.propertyName, n: 0 };
      b.n++; m.set(id, b);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => (building === 'all' || (r.propertyId ?? r.propertyName) === building)
      && (!needle || [r.unitNumber, r.propertyName, r.ownerName].some(s => s.toLowerCase().includes(needle))));
  }, [rows, q, building]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    const f = dir === 'asc' ? 1 : -1;
    out.sort((a, b) => sortKey === 'unit'
      ? f * (a.propertyName.localeCompare(b.propertyName) || a.unitNumber.localeCompare(b.unitNumber, 'en', { numeric: true }))
      : f * (NUMERIC(a, sortKey) - NUMERIC(b, sortKey)) || a.unitNumber.localeCompare(b.unitNumber, 'en', { numeric: true }));
    return out;
  }, [filtered, sortKey, dir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const shownPage = Math.min(page, pages);
  const pageRows = sorted.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE);

  // Summary over every matching unit. Occupancy and ADR are weighted by nights (sold nights over available
  // nights, revenue over sold nights), not an average of per-unit percentages.
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
  const cols = { gridTemplateColumns: colTemplate(withRating, withException) };

  function toggleSort(key: SortKey) {
    const next: Dir = sortKey === key ? (dir === 'desc' ? 'asc' : 'desc') : key === 'unit' ? 'asc' : 'desc';
    set({ sort: key === 'revenue' ? null : key, dir: next === (key === 'unit' ? 'asc' : 'desc') ? null : next });
  }

  const tiles = [
    { label: narrowed ? 'Units shown' : 'Listed units', value: count(n) },
    { label: 'Occupancy', value: percent(occ) },
    { label: 'ADR', value: money ? rm(adr, { cents: false }) : '—' },
    { label: 'Revenue', value: money ? rm(revenue, { cents: false }) : '—' },
  ];

  return (
    <>
      <PageHeader
        title="Portfolio performance"
        sub={`${plural(data?.units ?? rows.length, 'listed unit')} · ${plural(data?.buildings ?? buildings.length, 'building')} · ${caption}`}
        actions={
          <div role="group" aria-label="Period" className="flex items-center gap-2 max-w-full overflow-x-auto [scrollbar-width:none]">
            {PERIODS.map((p, i) => (
              <Chip key={p.key} on={p.key === period} onClick={() => set({ period: i === 0 ? null : p.key })}>{p.label}</Chip>
            ))}
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[10px] sm:gap-[14px]">
        {tiles.map(t => (
          <div key={t.label} className="bg-card border border-solid border-line rounded-card p-[14px] sm:p-[18px] flex flex-col gap-2 min-w-0">
            <div className="text-meta text-muted-ink">{t.label}</div>
            <div className="text-title sm:text-headline leading-[1.15] font-semibold tracking-[-0.01em] [font-variant-numeric:tabular-nums] whitespace-nowrap overflow-hidden text-ellipsis">{t.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <div className="pt-4 px-4 sm:px-5 pb-3 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-heading font-semibold">Every listed unit, {caption}</span>
            <span className="text-meta text-muted-ink">Sorted by {SORT_LABEL[sortKey]}, {dir === 'desc' ? 'high to low' : 'low to high'}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SearchBox value={q} onChange={v => set({ q: v })} placeholder="Search unit, building or owner" label="Search units"
              className="flex-1 min-w-[200px] max-w-[360px]" />
            <Select label="Building" value={building} onChange={v => set({ b: v === 'all' ? null : v })} className="w-full sm:w-[240px]"
              options={[{ value: 'all', label: 'All buildings' }, ...buildings.map(b => ({ value: b.id, label: `${b.name} (${b.n})` }))]} />
            {/* Phones have no column headers to tap, so sorting is a menu there. */}
            <Select label="Sort" value={`${sortKey}:${dir}`} className="md:hidden"
              onChange={v => { const [k, d] = v.split(':') as [SortKey, Dir]; set({ sort: k === 'revenue' ? null : k, dir: d === (k === 'unit' ? 'asc' : 'desc') ? null : d }); }}
              options={[
                { value: 'revenue:desc', label: 'Revenue, high to low' },
                { value: 'revenue:asc', label: 'Revenue, low to high' },
                { value: 'occupancy:desc', label: 'Occupancy, high to low' },
                { value: 'occupancy:asc', label: 'Occupancy, low to high' },
                { value: 'adr:desc', label: 'ADR, high to low' },
                { value: 'unit:asc', label: 'Unit, A to Z' },
              ]} />
            {narrowed && (
              <Button variant="tertiary" size="sm" icon={<Icon name="RotateCcw" size="sm" />} onClick={() => set({ q: null, b: null })}>Clear filters</Button>
            )}
          </div>
        </div>

        {loading && rows.length === 0 ? <TableSkeleton rows={8} cols={6} /> : sorted.length === 0 ? (
          <div className="[border-top:1px_solid_var(--color-line)]">
            {rows.length > 0
              ? <EmptyState bare kind="filtered" title="No units match these filters." action={{ label: 'Clear filters', onClick: () => set({ q: null, b: null }) }} />
              : <EmptyState bare icon="BarChart3" title="No listed units for this period."
                  body="Units appear here once they are listed and have nights in the period."
                  action={{ label: 'View all units', onClick: () => { window.location.hash = '#/properties/units'; } }} />}
          </div>
        ) : (
          <div className={cx('transition-opacity duration-150', stale && 'opacity-60')} aria-busy={stale}>
            {/* Desktop: the table scrolls inside the card so its header stays in view. */}
            <div className="hidden md:block max-h-[70vh] overflow-auto [scrollbar-width:thin] [border-top:1px_solid_var(--color-line)]">
              <div className="min-w-[1000px]">
                <div style={cols} className="sticky top-0 z-[1] grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-meta font-semibold text-muted-ink">
                  <SortHead label="Unit" col="unit" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <div>Owner</div>
                  <SortHead label="Occupancy" col="occupancy" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <SortHead label="ADR" col="adr" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <SortHead label="RevPAR" col="revpar" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <SortHead label="Revenue" col="revenue" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  {withRating && <SortHead label="Rating" col="rating" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />}
                  {withException && <div>Exception</div>}
                </div>
                {pageRows.map(u => (
                  <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}`}
                    style={cols} className={cx('grid gap-[14px] items-center min-h-[50px] py-2 px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit hover:text-inherit hover:bg-page')}>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={u.unitNumber}>{u.unitNumber}</span>
                      <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={u.propertyName}>{u.propertyName}</span>
                    </div>
                    <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={titleCase(u.ownerName)}>{titleCase(u.ownerName)}</span>
                    <span className={cx(NUM, 'text-copy')}>{percent(u.occupancy)}</span>
                    <span className={cx(NUM, 'text-copy')}>{money ? rm(u.adr, { cents: false }) : '—'}</span>
                    <span className={cx(NUM, 'text-copy')}>{money ? rm(u.revpar, { cents: false }) : '—'}</span>
                    <span className={cx(NUM, 'text-copy font-medium')}>{money ? rm(u.revenue, { cents: false }) : '—'}</span>
                    {withRating && <span className={cx(NUM, 'text-copy')}>{u.rating != null ? fmtRating(u.rating) : '—'}</span>}
                    {withException && <div className="min-w-0">{u.exception ? <Badge tone={u.exception.tone} label={u.exception.label} size="sm" /> : <span className="text-meta text-faint">None</span>}</div>}
                  </a>
                ))}
                {/* Totals for every unit that matches, not just this page. */}
                <div style={cols} className="sticky bottom-0 grid gap-[14px] items-center min-h-[46px] py-2 px-[22px] bg-page [border-top:1px_solid_var(--color-line)] text-copy font-semibold">
                  <span>{narrowed ? `${plural(n, 'matching unit')}` : `All ${plural(n, 'unit')}`}</span>
                  <span />
                  <span className={NUM}>{percent(occ)}</span>
                  <span className={NUM}>{money ? rm(adr, { cents: false }) : '—'}</span>
                  <span className={NUM}>{money ? rm(revpar, { cents: false }) : '—'}</span>
                  <span className={NUM}>{money ? rm(revenue, { cents: false }) : '—'}</span>
                  {withRating && <span />}{withException && <span />}
                </div>
              </div>
            </div>

            {/* Phone: one compact card per unit. */}
            <div className="md:hidden [border-top:1px_solid_var(--color-line)]">
              {pageRows.map(u => (
                <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}`}
                  className="flex flex-col gap-1.5 py-3 px-4 [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit hover:text-inherit">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{u.unitNumber} <span className="font-normal text-muted-ink text-meta">· {u.propertyName}</span></span>
                    <span className="flex-none text-copy font-semibold [font-variant-numeric:tabular-nums]">{money ? rm(u.revenue, { cents: false }) : percent(u.occupancy)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-meta text-muted-ink [font-variant-numeric:tabular-nums] whitespace-nowrap overflow-hidden text-ellipsis">
                      {percent(u.occupancy)} occupied{money ? ` · ADR ${rm(u.adr, { cents: false })}` : ''}
                    </span>
                    {u.exception && <Badge tone={u.exception.tone} label={u.exception.label} size="sm" />}
                  </div>
                </a>
              ))}
              <div className="flex items-baseline justify-between gap-3 py-3 px-4 bg-page text-copy font-semibold">
                <span>{narrowed ? `${count(n)} matching` : `All ${plural(n, 'unit')}`}</span>
                <span className="[font-variant-numeric:tabular-nums]">{money ? rm(revenue, { cents: false }) : ''} · {percent(occ)}</span>
              </div>
            </div>

            <ListPager page={shownPage} pageSize={PAGE_SIZE} total={sorted.length} onPage={p => set({ page: p > 1 ? String(p) : null }, true)} noun="units" />
          </div>
        )}
      </Card>
    </>
  );
}

/** A sortable column header. The active column carries the gold selection ink and a direction caret. */
function SortHead({ label, col, align = 'left', sortKey, dir, onSort }: {
  label: string; col: SortKey; align?: 'left' | 'right'; sortKey: SortKey; dir: Dir; onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button onClick={() => onSort(col)} aria-label={`Sort by ${label}`}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cx('flex items-center gap-[3px]', align === 'right' ? 'justify-end' : 'justify-start',
        'bg-transparent [border:none] p-0 cursor-pointer [font:inherit] text-meta font-semibold', active ? 'text-gold-ink' : 'text-muted-ink')}>
      <span>{label}</span>
      <Icon name={active ? (dir === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'ChevronsUpDown'} size="sm" style={{ opacity: active ? 1 : 0.4 }} />
    </button>
  );
}

