import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BarTrend, Eyebrow, Figure, Segmented, StatTile, TotalsRow } from '../components/Metric';
import { Card, CardHeader, LinkAction } from '../components/Card';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useCrew } from '../lib/useCrew';
import { useSession } from '../lib/session';
import { api, notifyFailure } from '../lib/api';
import { rm, rmCompact, time, percent, monthLabel, MONTHS, plural, count, humanize } from '../lib/format';
import { Select } from '../components/Select';
import { EmptyState } from '../components/States';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

/* ------------------------------------------------------------------ KPIs -- */
/* Kept as the existing read-only KPI row — see the brief: keep KPI row + chart. */

interface Kpi { key: string; value: number | string; currency?: string; unit?: string }
interface KpiPayload { kpis: Kpi[]; period: string; generatedAt: string }

const KPI_LABEL: Record<string, string> = {
  accommodation_revenue: 'Revenue', occupancy: 'Occupancy', adr: 'ADR',
  revpar: 'RevPAR', net_owner_payout: 'Owner payout',
};

const KPI_FALLBACK: KpiPayload = {
  period: '2026-09', generatedAt: '2026-09-16T06:06:00Z',
  kpis: [
    { key: 'occupancy', value: '86.2', unit: 'percent' },
    { key: 'accommodation_revenue', value: 12190000, currency: 'MYR' },
    { key: 'adr', value: 27600, currency: 'MYR' },
    { key: 'revpar', value: 23800, currency: 'MYR' },
    { key: 'net_owner_payout', value: 8890000, currency: 'MYR' },
  ],
};

/** The one figure shown as the dark statement tile. */
const HERO_KPI = 'accommodation_revenue';

function kpiValue(k: Kpi) {
  if (k.unit === 'percent') return `${k.value}%`;
  if (k.currency) return rm(Number(k.value), { cents: false });
  return String(k.value);
}

/* ----------------------------------------------------------------- Trend -- */
/* The revenue chart, now range-aware. 3M / 12M / YTD re-reads the chart from
 * /api/dashboard/trend?range=. `delta.tone` is decided by the backend — the sign
 * of the number never picks the colour (an expected seasonal dip is not red). */

type Range = '3m' | '12m' | 'ytd';

interface TrendPoint { period: string; revenue: number; occupancy: number; isCurrent?: boolean }
interface TrendTotals { grossBookingValue: number; collectedRevenue: number; managementFees: number; netOwnerPayout: number }
interface TrendPayload {
  generatedAt: string; currency: string;
  points: TrendPoint[];
  totals: TrendTotals;
  /** Server-supplied. `tone` is authoritative; `direction` is display only. */
  delta: { value: number; direction: 'up' | 'down' | 'flat'; tone: Tone; period?: string; against?: string };
}

const RANGES: { key: Range; label: string }[] = [
  { key: '3m', label: '3 months' },
  { key: '12m', label: '12 months' },
  { key: 'ytd', label: 'Year to date' },
];

const p = (period: string, revenue: number, occupancy: number, isCurrent?: boolean): TrendPoint =>
  ({ period, revenue, occupancy, isCurrent });

const EMPTY_TREND: TrendPayload = {
  generatedAt: '', currency: 'MYR', points: [],
  totals: { grossBookingValue: 0, collectedRevenue: 0, managementFees: 0, netOwnerPayout: 0 },
  delta: { value: 0, direction: 'flat', tone: 'neutral' },
};

const TREND: Record<Range, TrendPayload> = {
  '3m': {
    generatedAt: '2026-09-16T06:06:00Z', currency: 'MYR',
    points: [
      p('2026-07', 10800000, 82.4),
      p('2026-08', 11600000, 84.1),
      p('2026-09', 12200000, 86.2, true),
    ],
    totals: { grossBookingValue: 42100000, collectedRevenue: 35800000, managementFees: 8950000, netOwnerPayout: 26850000 },
    // Down against the previous three months, but an expected post-peak easing —
    // the backend keeps it neutral rather than red.
    delta: { value: 3.1, direction: 'down', tone: 'neutral' },
  },
  '12m': {
    generatedAt: '2026-09-16T06:06:00Z', currency: 'MYR',
    points: [
      p('2025-10', 9200000, 74.0), p('2025-11', 9600000, 76.2), p('2025-12', 11400000, 88.6),
      p('2026-01', 9800000, 76.8), p('2026-02', 10100000, 78.4), p('2026-03', 10600000, 80.1),
      p('2026-04', 9600000, 75.9), p('2026-05', 10400000, 79.7), p('2026-06', 11200000, 82.9),
      p('2026-07', 10800000, 82.4), p('2026-08', 11600000, 84.1), p('2026-09', 12200000, 86.2, true),
    ],
    totals: { grossBookingValue: 162400000, collectedRevenue: 139200000, managementFees: 34800000, netOwnerPayout: 104400000 },
    delta: { value: 9.4, direction: 'up', tone: 'success' },
  },
  'ytd': {
    generatedAt: '2026-09-16T06:06:00Z', currency: 'MYR',
    points: [
      p('2026-01', 9800000, 76.8), p('2026-02', 10100000, 78.4), p('2026-03', 10600000, 80.1),
      p('2026-04', 9600000, 75.9), p('2026-05', 10400000, 79.7), p('2026-06', 11200000, 82.9),
      p('2026-07', 10800000, 82.4), p('2026-08', 11600000, 84.1), p('2026-09', 12200000, 86.2, true),
    ],
    totals: { grossBookingValue: 123800000, collectedRevenue: 106100000, managementFees: 26525000, netOwnerPayout: 79575000 },
    delta: { value: 12.6, direction: 'up', tone: 'success' },
  },
};

const ARROW: Record<'up' | 'down' | 'flat', string> = { up: '↑', down: '↓', flat: '→' };

/** "Sep" from "2026-09". Fixed month names, never Intl (en-MY prints "Sept"). */
const shortMonth = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1] ?? period;
/** How many units the dashboard lists; the Portfolio page has every one. */
const TOP_UNITS = 8;

/* ----------------------------------------------------------------- Today -- */

interface TodayRow { key: string; count: number; tone: Tone }
interface TodayPayload { date: string; rows: TodayRow[]; generatedAt: string }

const TODAY_LABEL: Record<string, string> = {
  check_ins: 'Check-ins', check_outs: 'Check-outs', cleaning_pending: 'Cleaning pending',
  maintenance_open: 'Maintenance open', escalations: 'Guest escalations',
};

const TODAY_FALLBACK: TodayPayload = {
  date: '2026-09-16', generatedAt: '2026-09-16T06:06:00Z',
  rows: [
    { key: 'check_ins', count: 3, tone: 'info' },
    { key: 'check_outs', count: 2, tone: 'info' },
    { key: 'cleaning_pending', count: 5, tone: 'warning' },
    { key: 'maintenance_open', count: 3, tone: 'warning' },
    { key: 'escalations', count: 1, tone: 'critical' },
  ],
};

/* ------------------------------------------------------------ Exceptions -- */
/* One action per row (api.md): the backend decides which of the four it is. */

type ExActionLabel = 'Assign cleaner' | 'Notify owner' | 'Review and send' | 'Open pricing';

interface Exception {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  action: { label: ExActionLabel; taskId?: string };
  unitId?: string;
  unitLabel?: string;
  nextGuestAt?: string;
  slaLabel?: string;
  owner?: { id: string; name: string };
  reason?: string;
  datesBlocked?: string;
  revenueAtRisk?: number;
  expectedReturn?: string;
}
interface ExceptionPayload { exceptions: Exception[]; generatedAt: string }

const EXCEPTION_FALLBACK: ExceptionPayload = {
  generatedAt: '2026-09-16T06:06:00Z',
  exceptions: [
    {
      id: 'x1', tone: 'critical',
      title: 'Check-in at risk in 48 minutes',
      detail: 'The Establishment #A-21-02 is Dirty with no cleaner assigned. Guest arrives 15:00.',
      action: { label: 'Assign cleaner', taskId: 't1' },
      unitLabel: 'The Establishment #A-21-02', nextGuestAt: '15:00', slaLabel: 'Overdue 12 min',
    },
    {
      id: 'x2', tone: 'warning',
      title: 'Unit blocked for maintenance',
      detail: 'Sentral Suites #C-31-14 is off sale while plumbing is repaired. The owner has not been informed.',
      action: { label: 'Notify owner' },
      unitLabel: 'Sentral Suites #C-31-14',
      owner: { id: 'o2', name: 'Tan Boon Huat' },
      reason: 'Plumbing repair', datesBlocked: '16 – 18 Sep 2026',
      revenueAtRisk: 498000, expectedReturn: '19 Sep 2026',
    },
    {
      id: 'x3', tone: 'info',
      title: '2 statements ready to send',
      detail: 'August owner statements are finalised and waiting to go out.',
      action: { label: 'Review and send' },
    },
    {
      id: 'x4', tone: 'warning',
      title: 'Occupancy below target for two weeks',
      detail: 'Scarletz KLCC #15-06 has run at 79% since 2 September. Its pricing needs a review.',
      action: { label: 'Open pricing' },
      unitId: 'u4', unitLabel: 'Scarletz KLCC #15-06',
    },
  ],
};

/* ------------------------------------------------------------- Portfolio -- */

interface PortfolioRow {
  unitId: string; unitNumber: string; propertyName: string; ownerName: string;
  occupancy: number; adr: number; revpar: number; revenue: number; rating: number | null;
  exception: { label: string; tone: Tone } | null;
}
interface PortfolioPayload { rows: PortfolioRow[]; units: number; buildings: number; generatedAt: string }

const PORTFOLIO_FALLBACK: PortfolioPayload = {
  units: 38, buildings: 9, generatedAt: '2026-09-16T06:06:00Z',
  rows: [
    { unitId: 'u3', unitNumber: '#2207', propertyName: 'Tribeca', ownerName: 'Lim Chee Keong', occupancy: 91.0, adr: 31800, revpar: 28900, revenue: 901000, rating: 4.95, exception: null },
    { unitId: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', ownerName: 'Aina Zulkifli', occupancy: 94.1, adr: 28400, revpar: 26700, revenue: 812000, rating: 4.92, exception: null },
    { unitId: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', ownerName: 'Priya Sundaram', occupancy: 88.3, adr: 23100, revpar: 20400, revenue: 634000, rating: 4.88, exception: null },
    { unitId: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', ownerName: 'Faridah Ismail', occupancy: 79.4, adr: 26500, revpar: 21000, revenue: 588000, rating: 4.79, exception: { label: 'Pricing review', tone: 'warning' } },
    { unitId: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', ownerName: 'Tan Boon Huat', occupancy: 72.0, adr: 22800, revpar: 16400, revenue: 441000, rating: 4.71, exception: { label: 'Blocked', tone: 'critical' } },
    { unitId: 'u5', unitNumber: '#B-32-05', propertyName: 'Trion KL', ownerName: 'Nurul Huda', occupancy: 85.6, adr: 25200, revpar: 21600, revenue: 702000, rating: 4.86, exception: null },
  ],
};


const go = (hash: string) => { window.location.hash = hash; };

const NUM = 'tabular-nums whitespace-nowrap';
const TOP_COLUMNS: Column<PortfolioRow>[] = [
  { key: 'unit', label: 'Unit', value: u => u.unitNumber, text: u => `${u.unitNumber} ${u.propertyName}`, exportValue: u => u.unitNumber,
    hideable: false, width: 190, sub: u => u.propertyName,
    render: u => <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis block">{u.unitNumber}</span> },
  { key: 'occupancy', label: 'Occupancy', type: 'number', value: u => u.occupancy, width: 90, render: u => <span className={NUM}>{u.occupancy.toFixed(1)}%</span> },
  { key: 'adr', label: 'ADR', type: 'money', value: u => u.adr, width: 90, render: u => <span className={NUM}>{rm(u.adr, { cents: false })}</span> },
  { key: 'revpar', label: 'RevPAR', type: 'money', value: u => u.revpar, width: 90, render: u => <span className={NUM}>{rm(u.revpar, { cents: false })}</span> },
  { key: 'revenue', label: 'Revenue', type: 'money', value: u => u.revenue, width: 100, render: u => <span className={`${NUM} font-medium`}>{rm(u.revenue, { cents: false })}</span> },
  { key: 'exception', label: 'Exception', type: 'status', value: u => u.exception?.label ?? null, status: u => u.exception, width: 130, align: 'right',
    render: u => (u.exception ? <StatusBadge tone={u.exception.tone} label={u.exception.label} size="sm" /> : <span className="text-meta text-faint">None</span>) },
];

/* The exception tone drives the 3px left accent. It uses the design's -line
 * (non-text) shade, which lives only as a CSS var, applied per tone as a single
 * -property arbitrary border so no phantom UA-width borders appear on other sides. */
const LINE: Record<Tone, string> = {
  success:  '[border-left:3px_solid_var(--color-success-line)]',
  warning:  '[border-left:3px_solid_var(--color-warning-line)]',
  critical: '[border-left:3px_solid_var(--color-critical-line)]',
  info:     '[border-left:3px_solid_var(--color-info-line)]',
  neutral:  '[border-left:3px_solid_var(--color-neutral-line)]',
};

export default function DashboardPage() {
  const CREW = useCrew('housekeeping');
  const kpi = useApi<KpiPayload>('/dashboard/kpis', KPI_FALLBACK);

  const [range, setRange] = useState<Range>('12m');
  const trend = useApi<TrendPayload>(`/dashboard/trend?range=${range}`, TREND[range]);
  // In dev there is no backend, so a range change fails to refetch and useApi
  // keeps the previous payload. Fall back to the local dataset for the active
  // range whenever the live read is not available, so the toggle visibly moves.
  const tp = (trend.error ? null : trend.data) ?? (import.meta.env.DEV ? TREND[range] : EMPTY_TREND);
  const money = (sen: number) => tp === EMPTY_TREND ? '—' : rm(sen, { cents: false });

  const today = useApi<TodayPayload>('/dashboard/today', TODAY_FALLBACK);
  const exc = useApi<ExceptionPayload>('/dashboard/exceptions', EXCEPTION_FALLBACK);
  // Each part follows the role's levels (Users and roles > Permissions): a role with no access to Portfolio does
  // not load or see unit revenue, and an exception offers only the action the server will accept from it.
  const { user } = useSession();
  const level = (area: string) => user?.role === 'management' ? 'full' : user?.access?.[area] ?? 'none';
  const works = (area: string) => level(area) === 'edit' || level(area) === 'full';
  const seesPortfolio = level('portfolio') !== 'none';
  const seesOps = level('operations') !== 'none';
  const portfolio = useApi<PortfolioPayload>(seesPortfolio ? '/portfolio/performance' : null, PORTFOLIO_FALLBACK);
  const mayAct = (e: Exception) => {
    switch (e.action.label) {
      case 'Assign cleaner': return works('operations');
      case 'Notify owner': return ['management', 'operations_manager', 'operations_staff'].includes(user?.role ?? '');
      case 'Review and send': return level('finance') !== 'none';
      case 'Open pricing': return level('performance') === 'full';
      default: return true;
    }
  };

  const toast = useToast();

  // Optimistic overlay: resolved exceptions vanish so each action visibly lands.
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<{ ex: Exception; cleanerId: string } | null>(null);
  const [notify, setNotify] = useState<Exception | null>(null);

  // The API lists occupancy first (every role gets it; money only with manage), so revenue is moved to the front here.
  const kpis = [...(kpi.data?.kpis ?? [])].sort((a, b) => Number(b.key === HERO_KPI) - Number(a.key === HERO_KPI));
  const allExceptions = (exc.data?.exceptions ?? []).filter(e => !handled.has(e.id));
  const exceptions = allExceptions.slice(0, 5);
  const allRows = portfolio.data?.rows ?? [];
  const rows = [...allRows].sort((a, b) => b.revenue - a.revenue || b.occupancy - a.occupancy).slice(0, TOP_UNITS);

  const failure = kpi.error ?? today.error ?? exc.error ?? portfolio.error;
  const lastUpdated = kpi.data?.generatedAt ? time(kpi.data.generatedAt) : null;
  const period = kpi.data?.period ?? '';

  // --- Actions ---------------------------------------------------------------

  function resolve(id: string) { setHandled(h => new Set(h).add(id)); }

  function runException(e: Exception) {
    switch (e.action.label) {
      case 'Assign cleaner': setAssign({ ex: e, cleanerId: CREW[0]?.id ?? '' }); break;
      case 'Notify owner': setNotify(e); break;
      case 'Review and send': go('#/finance/statements'); break;
      case 'Open pricing': go(`#/performance/pricing?unitId=${encodeURIComponent(e.unitId ?? '')}`); break;
    }
  }

  function doAssign() {
    if (!assign) return;
    const cleaner = CREW.find(c => c.id === assign.cleanerId);
    if (!cleaner) return;
    const ex = assign.ex;
    resolve(ex.id);
    toast({ tone: 'success', title: 'Cleaner assigned.', body: `${cleaner.name} has been notified.` });
    setAssign(null);
    if (ex.action.taskId) api.post(`/housekeeping/tasks/${ex.action.taskId}/assign`, { assigneeId: cleaner.id }).catch(notifyFailure);
  }

  function doNotify() {
    if (!notify || !notify.owner) return;
    const ex = notify;
    const owner = ex.owner!;
    resolve(ex.id);
    toast({ tone: 'success', title: 'Owner notified.', body: `${owner.name} was sent the blocked-unit notice.` });
    setNotify(null);
    api.post(`/owners/${owner.id}/notify`, {
      unitLabel: ex.unitLabel, reason: ex.reason, datesBlocked: ex.datesBlocked,
      revenueAtRisk: ex.revenueAtRisk, expectedReturn: ex.expectedReturn,
    }).catch(notifyFailure);
  }

  const assignBusy = assign ? (CREW.find(c => c.id === assign.cleanerId)?.busy ?? 0) : 0;

  // --- Render ----------------------------------------------------------------

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={[period ? `${monthLabel(period)} to date` : '', lastUpdated ? `Last updated ${lastUpdated}` : ''].filter(Boolean).join(' · ')}
        actions={<Button variant="secondary" size="sm" onClick={() => go('#/properties/units')}>Add property</Button>}
        primary={<Button variant="primary" size="sm" icon={<Icon name="Plus" size="sm" />} onClick={() => go('#/reservations/bookings?create=1')}>Create reservation</Button>}
      />

      {failure && <StaleBanner message={`Showing the last figures we have. ${failure}`} onRetry={() => { kpi.reload(); trend.reload(); today.reload(); exc.reload(); portfolio.reload(); }} />}

      {/* KPI row — revenue leads as the one dark statement tile; the rest follow at equal weight. */}
      <div className="grid grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_repeat(4,minmax(0,1fr))] gap-3 sm:gap-4">
        {kpi.loading && kpis.length === 0
          ? Array.from({ length: 2 }).map((_, i) => <StatTile key={i} label={'\u00a0'} value="" loading />)
          : kpis.map(k => {
              const hero = k.key === HERO_KPI;
              return (
                <StatTile key={k.key} label={KPI_LABEL[k.key] ?? humanize(k.key)} value={kpiValue(k)}
                  hero={hero} className={hero ? 'col-span-2 xl:col-span-1' : undefined}
                  hint={hero && period ? `${monthLabel(period)} to date` : undefined} />
              );
            })}
      </div>

      {/* Trend chart + exceptions */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start">
        <Card style={{ padding: 0 }}>
          <div className="flex flex-col gap-5 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-[14px] flex-wrap">
              <div className="flex flex-col gap-1.5 min-w-0">
                <Eyebrow>Revenue and occupancy</Eyebrow>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <Figure value={money(tp.totals.grossBookingValue)} className="text-[26px] sm:text-[30px] font-medium tracking-[-0.025em] leading-none" />
                  {tp.delta.period && tp.delta.against && (
                    <span className={cx('text-meta font-semibold whitespace-nowrap', TONE[tp.delta.tone].text)}
                      title={`Revenue in ${monthLabel(tp.delta.period)} against ${monthLabel(tp.delta.against)}, the last two complete months`}>
                      {ARROW[tp.delta.direction]} {tp.delta.value.toFixed(1)}%
                      <span className="font-normal text-muted-ink"> {shortMonth(tp.delta.period)} vs {shortMonth(tp.delta.against)}</span>
                    </span>
                  )}
                </div>
                <span className="text-meta text-muted-ink">Gross booking value for the range, stays split by night</span>
              </div>

              {/* 3M / 12M / YTD — re-reads the chart from /dashboard/trend?range= */}
              <Segmented label="Trend range" options={RANGES} value={range} onChange={setRange} />
            </div>

            <BarTrend height={190} lineLabel="Occupancy under each month"
              bars={tp.points.map((s, i) => ({
                key: s.period,
                label: shortMonth(s.period),
                // The year only where it changes, so twelve labels do not repeat it twelve times.
                sub: i === 0 || s.period.endsWith('-01') ? s.period.slice(0, 4) : undefined,
                value: s.revenue,
                display: s.revenue > 0 ? rmCompact(s.revenue).replace('RM ', '') : '',
                title: `${monthLabel(s.period)} · ${rm(s.revenue, { cents: false })} · ${percent(s.occupancy)} occupancy`,
                current: s.isCurrent,
                lineDisplay: `${s.occupancy.toFixed(0)}%`,
              }))} />

            {/* The four totals are distinct definitions and are never merged. */}
            <TotalsRow items={[
              { label: 'Gross booking value', value: money(tp.totals.grossBookingValue) },
              { label: 'Collected revenue', value: money(tp.totals.collectedRevenue) },
              { label: 'Management fees', value: money(tp.totals.managementFees) },
              { label: 'Net owner payout', value: money(tp.totals.netOwnerPayout) },
            ]} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Needs attention" right={seesOps ? <LinkAction onClick={() => go('#/operations/today')}>Open operations →</LinkAction> : undefined} />
          {exc.loading && exceptions.length === 0 ? (
            <div className="pb-2"><TableSkeleton rows={3} cols={1} /></div>
          ) : exceptions.length === 0 ? (
            <EmptyState bare icon="Check" title="Nothing needs your attention right now." />
          ) : exceptions.map(e => (
            <div key={e.id} className={cx('flex flex-col gap-[9px] py-[13px] px-5 [border-top:1px_solid_var(--color-line-soft)]', LINE[e.tone])}>
              <div className="flex flex-col gap-[3px]">
                <span className="text-copy font-semibold text-pretty">{e.title}</span>
                <span className="text-meta text-muted-ink leading-[1.5] text-pretty">{e.detail}</span>
              </div>
              {mayAct(e) && <div>
                <Button
                  variant={e.action.label === 'Assign cleaner' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => runException(e)}
                >
                  {e.action.label}
                </Button>
              </div>}
            </div>
          ))}
          {allExceptions.length > exceptions.length && (
            <div className="py-3 px-5 [border-top:1px_solid_var(--color-line-soft)] text-meta text-muted-ink">
              {count(allExceptions.length - exceptions.length)} more in <a href="#/operations/today" className="text-gold-ink! no-underline font-semibold">Operations</a>
            </div>
          )}
        </Card>
      </div>

      {/* Today */}
      <Card>
        <CardHeader title="Today" right={seesOps ? <LinkAction onClick={() => go('#/operations/today')}>Open operations →</LinkAction> : undefined} />
        <div className="[border-top:1px_solid_var(--color-line)]">
         <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {(today.data?.rows ?? []).map(r => (
            <div key={r.key} className="flex flex-col gap-3 py-4 sm:py-5 px-4 sm:px-5 [border-left:1px_solid_var(--color-line-soft)] [border-top:1px_solid_var(--color-line-soft)]">
              <div className="flex items-center gap-2">
                <span className={cx('w-[7px] h-[7px] rounded-full flex-none', TONE[r.tone].dot)} aria-hidden />
                <Eyebrow>{TODAY_LABEL[r.key] ?? humanize(r.key)}</Eyebrow>
              </div>
              <span className="text-[26px] sm:text-[30px] leading-none font-medium tracking-[-0.025em] tabular-nums">{count(r.count)}</span>
            </div>
          ))}
         </div>
        </div>
      </Card>

      {/* Portfolio performance */}
      {seesPortfolio && <Card>
        <CardHeader
          title="Top units this month"
          right={<LinkAction onClick={() => go('#/portfolio')}>{portfolio.data ? `All ${count(portfolio.data.units)} units →` : 'All units →'}</LinkAction>}
        />
        <div className="pt-0 px-5 pb-3 -mt-2 text-meta text-muted-ink min-h-[18px]">
          {portfolio.data ? `The ${Math.min(TOP_UNITS, allRows.length)} highest by revenue of ${plural(portfolio.data.units, 'listed unit')} in ${plural(portfolio.data.buildings, 'building')}${period ? ` · ${monthLabel(period)} to date` : ''}` : ''}
        </div>
        <DataTable<PortfolioRow> id="dashboard.topunits" urlPrefix="top." bare noViews noToolbar pageSize={0} maxHeight="none"
          columns={TOP_COLUMNS} rows={portfolio.data ? rows : null} rowKey={u => u.unitId} noun={['unit', 'units']}
          onRowClick={u => go(`#/properties/units/${encodeURIComponent(u.unitId)}`)}
          empty={{ title: 'No listed units for this month yet.', icon: 'BarChart3' }}
          renderCard={u => (
            <span className="flex items-center justify-between gap-3">
              <span className="flex flex-col gap-px min-w-0">
                <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{u.unitNumber} <span className="font-normal text-meta text-muted-ink">· {u.propertyName}</span></span>
                <span className="text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{u.occupancy.toFixed(1)}% occupied · ADR {rm(u.adr, { cents: false })}</span>
              </span>
              <span className="flex-none text-copy font-semibold [font-variant-numeric:tabular-nums]">{rm(u.revenue, { cents: false })}</span>
            </span>
          )} />
      </Card>}

      {/* Assign cleaner — a chooser, so a local form modal (shared Dialog is confirm-only). */}
      {assign && (
        <Modal
          title={`Assign a cleaner to ${assign.ex.unitLabel ?? 'this unit'}?`}
          sub="They are notified immediately. The unit stays in its current state until they mark it ready with a photo."
          onClose={() => setAssign(null)}
          footer={<>
            <Button variant="secondary" size="sm" onClick={() => setAssign(null)}>Cancel</Button>
            <Button variant={assignBusy > 0 ? 'danger' : 'primary'} size="sm" onClick={doAssign}>
              {assignBusy > 0 ? 'Assign anyway' : 'Assign cleaner'}
            </Button>
          </>}
        >
          <Select label="Cleaner" showLabel size="md" value={assign.cleanerId}
            onChange={v => setAssign(a => a && { ...a, cleanerId: v })}
            options={CREW.map(c => ({ value: c.id, label: c.name }))} />
          {assign.ex.nextGuestAt && (
            <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta">
              Next guest arrives {assign.ex.nextGuestAt}{assign.ex.slaLabel ? ` · ${assign.ex.slaLabel}` : ''}
            </div>
          )}
          {assignBusy > 0 && (
            <div role="status" className={cx('py-[9px] px-[11px] rounded-control text-meta', TONE.warning.bg, TONE.warning.text)}>
              {CREW.find(c => c.id === assign.cleanerId)?.name} already has {plural(assignBusy, 'overlapping task')} today. Assign anyway?
            </div>
          )}
        </Modal>
      )}

      {/* Notify owner — confirmation-only, so the shared Dialog fits. */}
      <ConfirmDialog
        busy={false}
        onClose={() => setNotify(null)}
        spec={!notify || !notify.owner ? null : {
          title: `Send a blocked-unit notice to ${notify.owner.name}?`,
          body: 'The owner receives the dates blocked, the reason, the revenue at risk and the expected return date. Nothing is charged and no work is approved by this notice.',
          meta: `${notify.unitLabel ?? ''}${notify.datesBlocked ? ` · ${notify.datesBlocked}` : ''}${notify.revenueAtRisk != null ? ` · ${rm(notify.revenueAtRisk)} at risk` : ''}${notify.expectedReturn ? ` · back ${notify.expectedReturn}` : ''}`,
          confirmLabel: 'Send notice',
          onConfirm: doNotify,
        }}
      />
    </>
  );
}

/** Local modal shell for the one dialog that carries a form field. Mirrors the
 *  shared Dialog chrome and its focus/escape behaviour. */
function Modal({ title, sub, onClose, children, footer }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select, textarea, input, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[460px] bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden animate-dialog">
        <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[9px]">
          <h2 className="m-0 text-title leading-[1.3] font-semibold text-pretty">{title}</h2>
          {sub && <p className="m-0 text-copy leading-[1.55] text-muted-ink text-pretty">{sub}</p>}
        </div>
        <div className="pt-[14px] px-[22px] pb-[18px] flex flex-col gap-3">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          {footer}
        </div>
      </div>
    </div>
  );
}
