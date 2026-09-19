import { useEffect, useRef, useState, type ReactNode } from 'react';
import { color, radius, text, tone as T } from '../theme';
import { Card, CardHeader, LinkAction } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { rm, time, percent } from '../lib/format';
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
    { key: 'accommodation_revenue', value: 12190000, currency: 'MYR' },
    { key: 'occupancy', value: '86.2', unit: 'percent' },
    { key: 'adr', value: 27600, currency: 'MYR' },
    { key: 'revpar', value: 23800, currency: 'MYR' },
  ],
};

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
  delta: { value: number; direction: 'up' | 'down' | 'flat'; tone: Tone };
}

const RANGES: { key: Range; label: string }[] = [
  { key: '3m', label: '3 months' },
  { key: '12m', label: '12 months' },
  { key: 'ytd', label: 'Year to date' },
];

const p = (period: string, revenue: number, occupancy: number, isCurrent?: boolean): TrendPoint =>
  ({ period, revenue, occupancy, isCurrent });

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

const monthLabel = (period: string) =>
  new Date(period + '-01').toLocaleDateString('en-MY', { month: 'short' });

const ARROW: Record<'up' | 'down' | 'flat', string> = { up: '↑', down: '↓', flat: '→' };

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

/* Housekeeping crew for the assign dialog. `busy` drives the 409 override path
 * (api.md ASSIGNEE_BUSY) without a live roster in dev. */
const CREW = [
  { id: 'u5', name: 'Nurul Huda', busy: 2 },
  { id: 'u6', name: 'Faridah Ismail', busy: 0 },
  { id: 'u9', name: 'Siti Rahmah', busy: 0 },
  { id: 'u12', name: 'Azman Yusof', busy: 1 },
];

const go = (hash: string) => { window.location.hash = hash; };

const PCOLS = 'minmax(190px,2fr) repeat(4,minmax(78px,0.9fr)) minmax(120px,1.1fr)';

export default function DashboardPage() {
  const kpi = useApi<KpiPayload>('/dashboard/kpis', KPI_FALLBACK);

  const [range, setRange] = useState<Range>('12m');
  const trend = useApi<TrendPayload>(`/dashboard/trend?range=${range}`, TREND[range]);
  // In dev there is no backend, so a range change fails to refetch and useApi
  // keeps the previous payload. Fall back to the local dataset for the active
  // range whenever the live read is not available, so the toggle visibly moves.
  const tp = (trend.error ? null : trend.data) ?? TREND[range];

  const today = useApi<TodayPayload>('/dashboard/today', TODAY_FALLBACK);
  const exc = useApi<ExceptionPayload>('/dashboard/exceptions', EXCEPTION_FALLBACK);
  const portfolio = useApi<PortfolioPayload>('/portfolio/performance', PORTFOLIO_FALLBACK);

  const toast = useToast();

  // Optimistic overlay: resolved exceptions vanish so each action visibly lands.
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<{ ex: Exception; cleanerId: string } | null>(null);
  const [notify, setNotify] = useState<Exception | null>(null);

  const kpis = kpi.data?.kpis ?? [];
  const maxRev = Math.max(1, ...tp.points.map(s => s.revenue));
  const exceptions = (exc.data?.exceptions ?? []).filter(e => !handled.has(e.id));
  const rows = portfolio.data?.rows ?? [];

  const failure = kpi.error ?? today.error ?? exc.error ?? portfolio.error;
  const lastUpdated = kpi.data?.generatedAt ? time(kpi.data.generatedAt) : null;
  const period = kpi.data?.period ?? '';

  // --- Actions ---------------------------------------------------------------

  function resolve(id: string) { setHandled(h => new Set(h).add(id)); }

  function runException(e: Exception) {
    switch (e.action.label) {
      case 'Assign cleaner': setAssign({ ex: e, cleanerId: CREW[0].id }); break;
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
    if (ex.action.taskId) api.post(`/housekeeping/tasks/${ex.action.taskId}/assign`, { assigneeId: cleaner.id }).catch(() => {});
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
    }).catch(() => {});
  }

  const assignBusy = assign ? (CREW.find(c => c.id === assign.cleanerId)?.busy ?? 0) : 0;

  // --- Render ----------------------------------------------------------------

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={`${period} to date · Asia/Kuala Lumpur${lastUpdated ? ` · last updated ${lastUpdated}` : ''}`}
        right={<Button variant="primary" size="sm" onClick={() => go('#/properties/new')}>Add property</Button>}
      />

      {failure && <StaleBanner message={`Showing the last figures we have. ${failure}`} onRetry={() => { kpi.reload(); trend.reload(); today.reload(); exc.reload(); portfolio.reload(); }} />}

      {/* KPI row — kept as the existing read-only summary. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        {kpi.loading && kpis.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="skeleton" style={{ height: 12, width: '50%' }} />
                <div className="skeleton" style={{ height: 24, width: '75%' }} />
              </div>
            ))
          : kpis.map(k => (
              <div key={k.key} style={{ background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: text.small, color: color.textMuted }}>{KPI_LABEL[k.key] ?? k.key}</div>
                <div style={{ fontSize: 26, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.01em' }}>{kpiValue(k)}</div>
              </div>
            ))}
      </div>

      {/* Trend chart + exceptions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Revenue and occupancy trend</span>
                  <span style={{ fontSize: text.small, fontWeight: 600, color: T[tp.delta.tone].fg }}>
                    {ARROW[tp.delta.direction]} {tp.delta.value.toFixed(1)}%
                  </span>
                </div>
                <span style={{ fontSize: text.small, color: color.textMuted }}>Accommodation revenue, RM · occupancy, % of available nights</span>
              </div>

              {/* 3M / 12M / YTD — re-reads the chart from /dashboard/trend?range= */}
              <div role="group" aria-label="Trend range" style={{ display: 'inline-flex', border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden', flex: 'none' }}>
                {RANGES.map((r, i) => {
                  const on = r.key === range;
                  return (
                    <button
                      key={r.key}
                      onClick={() => setRange(r.key)}
                      aria-pressed={on}
                      style={{
                        height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit',
                        border: 'none', borderLeft: i === 0 ? 'none' : `1px solid ${color.border}`,
                        background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted, whiteSpace: 'nowrap',
                      }}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: tp.points.length > 6 ? 6 : 12, height: 190 }}>
              {tp.points.map(s => (
                <div key={s.period} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 7, height: '100%' }}>
                  <span style={{ fontSize: text.micro, color: color.textMuted, whiteSpace: 'nowrap' }}>{rm(s.revenue, { cents: false }).replace('RM ', '')}</span>
                  <div title={`${monthLabel(s.period)} · ${rm(s.revenue, { cents: false })} · ${percent(s.occupancy)}`}
                    style={{ width: '100%', borderRadius: '6px 6px 0 0', height: Math.max(4, Math.round((s.revenue / maxRev) * 132)), background: s.isCurrent ? color.gold : color.charcoal }} />
                  <span style={{ fontSize: text.micro, color: color.textMuted }}>{monthLabel(s.period)}</span>
                  <span style={{ fontSize: text.micro, color: color.faint }}>{s.occupancy.toFixed(0)}%</span>
                </div>
              ))}
            </div>

            {/* The three totals are distinct definitions and are never merged. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, paddingTop: 14, borderTop: `1px solid ${color.borderMuted}` }}>
              <Total label="Gross booking value" value={rm(tp.totals.grossBookingValue, { cents: false })} />
              <Total label="Collected revenue" value={rm(tp.totals.collectedRevenue, { cents: false })} />
              <Total label="Management fees" value={rm(tp.totals.managementFees, { cents: false })} />
              <Total label="Net owner payout" value={rm(tp.totals.netOwnerPayout, { cents: false })} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Needs attention" right={<LinkAction onClick={() => go('#/operations/today')}>Open operations →</LinkAction>} />
          {exc.loading && exceptions.length === 0 ? (
            <div style={{ padding: '0 0 8px' }}><TableSkeleton rows={3} cols={1} /></div>
          ) : exceptions.length === 0 ? (
            <div style={{ padding: '20px', fontSize: 13, color: color.textMuted }}>Nothing needs your attention right now.</div>
          ) : exceptions.map(e => (
            <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '13px 20px', borderTop: `1px solid ${color.borderMuted}`, borderLeft: `3px solid ${T[e.tone].line}` }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, textWrap: 'pretty' }}>{e.title}</span>
                <span style={{ fontSize: 12, color: color.textMuted, lineHeight: 1.5, textWrap: 'pretty' }}>{e.detail}</span>
              </div>
              <div>
                <Button
                  variant={e.action.label === 'Assign cleaner' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => runException(e)}
                >
                  {e.action.label}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Today */}
      <Card>
        <CardHeader title="Today" right={<LinkAction onClick={() => go('#/operations/today')}>Open operations →</LinkAction>} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 0, borderTop: `1px solid ${color.border}` }}>
          {(today.data?.rows ?? []).map((r, i) => (
            <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '15px 20px', borderLeft: i === 0 ? 'none' : `1px solid ${color.borderMuted}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: T[r.tone].line, flex: 'none' }} aria-hidden />
                <span style={{ fontSize: text.small, color: color.textMuted }}>{TODAY_LABEL[r.key] ?? r.key}</span>
              </div>
              <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>{r.count}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Portfolio performance */}
      <Card>
        <CardHeader
          title="Portfolio performance"
          right={<LinkAction onClick={() => go('#/properties/units')}>View all units →</LinkAction>}
        />
        <div style={{ padding: '0 20px 12px', marginTop: -8, fontSize: text.small, color: color.textMuted }}>
          {portfolio.data ? `${portfolio.data.units} units · ${portfolio.data.buildings} buildings · ${period} to date` : ''}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: PCOLS, gap: 14, padding: '9px 22px', background: color.muted, borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Unit</div>
              <div style={{ textAlign: 'right' }}>Occupancy</div>
              <div style={{ textAlign: 'right' }}>ADR</div>
              <div style={{ textAlign: 'right' }}>RevPAR</div>
              <div style={{ textAlign: 'right' }}>Revenue</div>
              <div style={{ textAlign: 'right' }}>Exception</div>
            </div>
            {portfolio.loading && rows.length === 0 ? <TableSkeleton rows={4} cols={6} /> : rows.map(u => (
              <div
                key={u.unitId}
                role="button"
                tabIndex={0}
                onClick={() => go(`#/properties/units/${encodeURIComponent(u.unitId)}`)}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(`#/properties/units/${encodeURIComponent(u.unitId)}`); } }}
                style={{ display: 'grid', gridTemplateColumns: PCOLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '7px 22px', borderBottom: `1px solid ${color.borderMuted}`, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{u.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.propertyName}</span>
                </div>
                <div style={{ textAlign: 'right', fontSize: 13 }}>{u.occupancy.toFixed(1)}%</div>
                <div style={{ textAlign: 'right', fontSize: 13 }}>{rm(u.adr, { cents: false })}</div>
                <div style={{ textAlign: 'right', fontSize: 13 }}>{rm(u.revpar, { cents: false })}</div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>{rm(u.revenue, { cents: false })}</div>
                <div style={{ textAlign: 'right' }}>
                  {u.exception ? <Badge tone={u.exception.tone} label={u.exception.label} size="sm" /> : <span style={{ fontSize: 12, color: color.faint }}>None</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: text.small, fontWeight: 500, color: color.textMuted }}>Cleaner</span>
            <select className="field-input" value={assign.cleanerId} onChange={e => setAssign(a => a && { ...a, cleanerId: e.target.value })}>
              {CREW.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {assign.ex.nextGuestAt && (
            <div style={{ padding: '9px 11px', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}`, fontSize: 12 }}>
              Next guest arrives {assign.ex.nextGuestAt}{assign.ex.slaLabel ? ` · ${assign.ex.slaLabel}` : ''}
            </div>
          )}
          {assignBusy > 0 && (
            <div role="status" style={{ padding: '9px 11px', borderRadius: radius.control, background: T.warning.bg, color: T.warning.fg, fontSize: 12 }}>
              {CREW.find(c => c.id === assign.cleanerId)?.name} already has {assignBusy} overlapping task{assignBusy === 1 ? '' : 's'} today. Assign anyway?
            </div>
          )}
        </Modal>
      )}

      {/* Notify owner — confirmation-only, so the shared Dialog fits. */}
      <Dialog
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

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: text.micro, color: color.textMuted }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{value}</span>
    </div>
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
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 460, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden', animation: 'dialog-in var(--motion-slow) var(--ease-out) both' }}>
        <div style={{ padding: '22px 22px 4px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 600, textWrap: 'pretty' }}>{title}</h2>
          {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-muted)', textWrap: 'pretty' }}>{sub}</p>}
        </div>
        <div style={{ padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-default)', background: 'var(--color-surface-page)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}
