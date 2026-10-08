import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { ListPager } from '../components/ListPager';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm, percent, rating as fmtRating, todayMyt, monthLabel } from '../lib/format';
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

/* Unit, owner, occupancy, ADR, RevPAR, revenue, rating, exception — one literal so header, rows and the
 * totals row stay in lockstep (and Tailwind can see it). */
const COLS = 'grid-cols-[minmax(180px,1.8fr)_minmax(120px,1.1fr)_minmax(92px,0.8fr)_minmax(88px,0.8fr)_minmax(88px,0.8fr)_minmax(110px,1fr)_minmax(64px,0.6fr)_minmax(120px,1.1fr)]';
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

  function toggleSort(key: SortKey) {
    const next: Dir = sortKey === key ? (dir === 'desc' ? 'asc' : 'desc') : key === 'unit' ? 'asc' : 'desc';
    set({ sort: key === 'revenue' ? null : key, dir: next === (key === 'unit' ? 'asc' : 'desc') ? null : next });
  }

  const tiles = [
    { label: narrowed ? 'Units shown' : 'Listed units', value: n.toLocaleString('en-MY') },
    { label: 'Occupancy', value: percent(occ) },
    { label: 'ADR', value: money ? rm(adr, { cents: false }) : '—' },
    { label: 'Revenue', value: money ? rm(revenue, { cents: false }) : '—' },
  ];

  return (
    <>
      <PageHeader
        title="Portfolio performance"
        sub={`${data?.units ?? rows.length} listed units · ${data?.buildings ?? buildings.length} buildings · ${caption}`}
        right={
          <div role="group" aria-label="Period" className="inline-flex max-w-full overflow-x-auto [scrollbar-width:none] border border-solid border-line rounded-control flex-none">
            {PERIODS.map((p, i) => {
              const on = p.key === period;
              return (
                <button key={p.key} onClick={() => set({ period: i === 0 ? null : p.key })} aria-pressed={on}
                  className={cx('h-8 px-[13px] py-0 cursor-pointer [font:inherit] whitespace-nowrap flex-none',
                    '[border-top:0] [border-right:0] [border-bottom:0]',
                    i === 0 ? '[border-left:0]' : '[border-left:1px_solid_var(--color-line)]',
                    on ? 'bg-black text-white' : 'bg-card text-muted-ink')}>
                  {p.label}
                </button>
              );
            })}
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[10px] sm:gap-[14px]">
        {tiles.map(t => (
          <div key={t.label} className="bg-card border border-solid border-line rounded-card p-[14px] sm:p-[18px] flex flex-col gap-2 min-w-0">
            <div className="text-[12px] text-muted-ink">{t.label}</div>
            <div className="text-[20px] sm:text-[26px] leading-[1.15] font-semibold tracking-[-0.01em] [font-variant-numeric:tabular-nums] whitespace-nowrap overflow-hidden text-ellipsis">{t.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <div className="pt-4 px-4 sm:px-5 pb-3 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-[16px] font-semibold">Every listed unit, {caption}</span>
            <span className="text-[12px] text-muted-ink">Sorted by {SORT_LABEL[sortKey]}, {dir === 'desc' ? 'high to low' : 'low to high'}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex items-center flex-1 min-w-[200px] max-w-[360px]">
              <span className="absolute left-[10px] text-muted-ink flex pointer-events-none"><Icon name="Search" size="sm" /></span>
              <input value={q} onChange={e => set({ q: e.target.value })} placeholder="Search unit, building or owner" aria-label="Search units"
                className="field-input h-[36px]! w-full pl-[32px]! text-[13px]!" />
            </div>
            <select value={building} onChange={e => set({ b: e.target.value === 'all' ? null : e.target.value })} aria-label="Building"
              className="h-[36px] px-2.5 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer max-w-full sm:max-w-[240px]">
              <option value="all">All buildings</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name} ({b.n})</option>)}
            </select>
            {/* Phones have no column headers to tap, so sorting is a menu there. */}
            <select value={`${sortKey}:${dir}`} aria-label="Sort"
              onChange={e => { const [k, d] = e.target.value.split(':') as [SortKey, Dir]; set({ sort: k === 'revenue' ? null : k, dir: d === (k === 'unit' ? 'asc' : 'desc') ? null : d }); }}
              className="md:hidden h-[36px] px-2.5 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="revenue:desc">Revenue, high to low</option>
              <option value="revenue:asc">Revenue, low to high</option>
              <option value="occupancy:desc">Occupancy, high to low</option>
              <option value="occupancy:asc">Occupancy, low to high</option>
              <option value="adr:desc">ADR, high to low</option>
              <option value="unit:asc">Unit, A to Z</option>
            </select>
            {narrowed && (
              <button type="button" onClick={() => set({ q: null, b: null })}
                className="inline-flex items-center gap-1 h-[36px] px-1.5 bg-transparent border-none cursor-pointer font-sans text-[12.5px] font-medium text-muted-ink hover:text-ink">
                <Icon name="RotateCcw" size="sm" />Reset
              </button>
            )}
          </div>
        </div>

        {loading && rows.length === 0 ? <TableSkeleton rows={8} cols={6} /> : sorted.length === 0 ? (
          <EmptyState filtered={rows.length > 0} onReset={() => set({ q: null, b: null })} />
        ) : (
          <div className={cx('transition-opacity duration-150', stale && 'opacity-60')} aria-busy={stale}>
            {/* Desktop: the table scrolls inside the card so its header stays in view. */}
            <div className="hidden md:block max-h-[70vh] overflow-auto [scrollbar-width:thin] [border-top:1px_solid_var(--color-line)]">
              <div className="min-w-[1000px]">
                <div className={cx(COLS, 'sticky top-0 z-[1] grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
                  <SortHead label="Unit" col="unit" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <div>Owner</div>
                  <SortHead label="Occupancy" col="occupancy" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <SortHead label="ADR" col="adr" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <SortHead label="RevPAR" col="revpar" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <SortHead label="Revenue" col="revenue" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <SortHead label="Rating" col="rating" align="right" sortKey={sortKey} dir={dir} onSort={toggleSort} />
                  <div>Exception</div>
                </div>
                {pageRows.map(u => (
                  <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}`}
                    className={cx(COLS, 'grid gap-[14px] items-center min-h-[50px] py-2 px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit hover:text-inherit hover:bg-page')}>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={u.unitNumber}>{u.unitNumber}</span>
                      <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={u.propertyName}>{u.propertyName}</span>
                    </div>
                    <span className="text-[12.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={u.ownerName}>{u.ownerName}</span>
                    <span className={cx(NUM, 'text-[13px]')}>{percent(u.occupancy)}</span>
                    <span className={cx(NUM, 'text-[13px]')}>{money ? rm(u.adr, { cents: false }) : '—'}</span>
                    <span className={cx(NUM, 'text-[13px]')}>{money ? rm(u.revpar, { cents: false }) : '—'}</span>
                    <span className={cx(NUM, 'text-[13px] font-medium')}>{money ? rm(u.revenue, { cents: false }) : '—'}</span>
                    <span className={cx(NUM, 'text-[13px]')}>{u.rating != null ? fmtRating(u.rating) : '—'}</span>
                    <div className="min-w-0">{u.exception ? <Badge tone={u.exception.tone} label={u.exception.label} size="sm" /> : <span className="text-[12px] text-faint">None</span>}</div>
                  </a>
                ))}
                {/* Totals for every unit that matches, not just this page. */}
                <div className={cx(COLS, 'sticky bottom-0 grid gap-[14px] items-center min-h-[46px] py-2 px-[22px] bg-page [border-top:1px_solid_var(--color-line)] text-[13px] font-semibold')}>
                  <span>{narrowed ? `${n} matching ${n === 1 ? 'unit' : 'units'}` : `All ${n} units`}</span>
                  <span />
                  <span className={NUM}>{percent(occ)}</span>
                  <span className={NUM}>{money ? rm(adr, { cents: false }) : '—'}</span>
                  <span className={NUM}>{money ? rm(revpar, { cents: false }) : '—'}</span>
                  <span className={NUM}>{money ? rm(revenue, { cents: false }) : '—'}</span>
                  <span /><span />
                </div>
              </div>
            </div>

            {/* Phone: one compact card per unit. */}
            <div className="md:hidden [border-top:1px_solid_var(--color-line)]">
              {pageRows.map(u => (
                <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}`}
                  className="flex flex-col gap-1.5 py-3 px-4 [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit hover:text-inherit">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[14px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{u.unitNumber} <span className="font-normal text-muted-ink text-[12px]">· {u.propertyName}</span></span>
                    <span className="flex-none text-[14px] font-semibold [font-variant-numeric:tabular-nums]">{money ? rm(u.revenue, { cents: false }) : percent(u.occupancy)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-muted-ink [font-variant-numeric:tabular-nums] whitespace-nowrap overflow-hidden text-ellipsis">
                      {percent(u.occupancy)} occupied{money ? ` · ADR ${rm(u.adr, { cents: false })}` : ''}
                    </span>
                    {u.exception && <Badge tone={u.exception.tone} label={u.exception.label} size="sm" />}
                  </div>
                </a>
              ))}
              <div className="flex items-baseline justify-between gap-3 py-3 px-4 bg-page text-[13px] font-semibold">
                <span>{narrowed ? `${n} matching` : `All ${n} units`}</span>
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
        'bg-transparent [border:none] p-0 cursor-pointer [font:inherit] text-[12px] font-semibold', active ? 'text-gold-ink' : 'text-muted-ink')}>
      <span>{label}</span>
      <Icon name={active ? (dir === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'ChevronsUpDown'} size="sm" style={{ opacity: active ? 1 : 0.4 }} />
    </button>
  );
}

function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="py-12 px-[22px] flex flex-col items-center gap-3 text-center [border-top:1px_solid_var(--color-line)]">
      <span className="text-muted-ink"><Icon name="BarChart3" /></span>
      <div className="text-[14px] text-muted-ink max-w-[360px]">{filtered ? 'No unit matches that search.' : 'No listed units for this period.'}</div>
      {filtered
        ? <button type="button" onClick={onReset} className="bg-transparent border-none cursor-pointer font-sans text-[12px] font-semibold text-gold-ink">Clear the search</button>
        : <a href="#/properties/units" className="text-[12px] font-semibold text-gold-ink! no-underline">View all units</a>}
    </div>
  );
}
