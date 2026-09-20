import { color, radius, text, tone as T } from '../theme';
import { Card, CardHeader, LinkAction } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
interface Kpi { key: string; value: number | string; currency?: string; unit?: string }
interface KpiPayload { kpis: Kpi[]; period: string; generatedAt: string }

interface Unit {
  unitId: string; unitNumber: string; propertyName: string;
  occupancy: number; adr: number; revenue: number; rating: number | null;
}
interface AnalyticsPayload {
  series: { period: string; revenue: number; adr: number }[];
  units: Unit[];
  weakest: Unit[];
}

const KPI_LABEL: Record<string, string> = {
  accommodation_revenue: 'Revenue', occupancy: 'Occupancy', adr: 'ADR',
  revpar: 'RevPAR', net_owner_payout: 'Owner payout',
};

const KPI_FALLBACK: KpiPayload = {
  period: '2026-09', generatedAt: '',
  kpis: [
    { key: 'accommodation_revenue', value: 12190000, currency: 'MYR' },
    { key: 'occupancy', value: '86.2', unit: 'percent' },
    { key: 'adr', value: 27600, currency: 'MYR' },
    { key: 'revpar', value: 23800, currency: 'MYR' },
  ],
};

const ANALYTICS_FALLBACK: AnalyticsPayload = {
  series: [
    { period: '2026-04', revenue: 9600000, adr: 24800 },
    { period: '2026-05', revenue: 10400000, adr: 25600 },
    { period: '2026-06', revenue: 11200000, adr: 26800 },
    { period: '2026-07', revenue: 10800000, adr: 26200 },
    { period: '2026-08', revenue: 11600000, adr: 27100 },
    { period: '2026-09', revenue: 12200000, adr: 27600 },
  ],
  units: [
    { unitId: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', occupancy: 94.1, adr: 28400, revenue: 812000, rating: 4.92 },
    { unitId: 'u3', unitNumber: '#2207', propertyName: 'Tribeca', occupancy: 91.0, adr: 31800, revenue: 901000, rating: 4.95 },
    { unitId: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris', occupancy: 88.3, adr: 23100, revenue: 634000, rating: 4.88 },
  ],
  weakest: [
    { unitId: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', occupancy: 72.0, adr: 22800, revenue: 441000, rating: 4.71 },
    { unitId: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz', occupancy: 79.4, adr: 26500, revenue: 588000, rating: 4.79 },
  ],
};

const monthLabel = (p: string) =>
  new Date(p + '-01').toLocaleDateString('en-MY', { month: 'short' });

function kpiValue(k: Kpi) {
  if (k.unit === 'percent') return `${k.value}%`;
  if (k.currency) return rm(Number(k.value), { cents: false });
  return String(k.value);
}

export default function DashboardPage() {
  const kpi = useApi<KpiPayload>('/dashboard/kpis', KPI_FALLBACK);
  const an = useApi<AnalyticsPayload>('/analytics?months=6', ANALYTICS_FALLBACK);

  const kpis = kpi.data?.kpis ?? [];
  const series = an.data?.series ?? [];
  const maxRev = Math.max(1, ...series.map(s => s.revenue));
  const weakest = an.data?.weakest ?? [];
  const best = an.data?.units ?? [];
  const failure = kpi.error ?? an.error;

  return (
    <>
      <PageHeader title="Dashboard" sub={`${kpi.data?.period ?? ''} to date · Asia/Kuala Lumpur`} />

      {failure && <StaleBanner message={`Showing the last figures we have. ${failure}`} onRetry={() => { kpi.reload(); an.reload(); }} />}

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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Revenue, last 6 months</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 190 }}>
              {series.map((s, i) => (
                <div key={s.period} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 8, height: '100%' }}>
                  <span style={{ fontSize: text.micro, color: color.textMuted }}>{rm(s.revenue, { cents: false }).replace('RM ', '')}</span>
                  <div style={{ width: '100%', borderRadius: '6px 6px 0 0', height: Math.round((s.revenue / maxRev) * 140), background: i === series.length - 1 ? color.gold : color.charcoal }} />
                  <span style={{ fontSize: text.micro, color: color.textMuted }}>{monthLabel(s.period)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Needs a pricing review" right={<LinkAction>Pricing →</LinkAction>} />
          {weakest.length === 0 ? (
            <div style={{ padding: '20px', fontSize: 13, color: color.textMuted }}>Every unit is at or above target.</div>
          ) : weakest.map(u => (
            <div key={u.unitId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '13px 20px', borderTop: `1px solid ${color.borderMuted}` }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{u.unitNumber}</span>
                <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.propertyName}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 'none' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.warning.fg }}>{u.occupancy.toFixed(1)}%</span>
                <span style={{ fontSize: 12, color: color.textMuted }}>{rm(u.adr, { cents: false })}</span>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Card>
        <CardHeader title="Strongest units" right={<LinkAction>Full portfolio →</LinkAction>} />
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) repeat(4,minmax(84px,1fr))', gap: 14, padding: '9px 22px', background: color.muted, borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Unit</div>
              <div style={{ textAlign: 'right' }}>Occupancy</div>
              <div style={{ textAlign: 'right' }}>ADR</div>
              <div style={{ textAlign: 'right' }}>Revenue</div>
              <div style={{ textAlign: 'right' }}>Rating</div>
            </div>
            {an.loading && best.length === 0 ? <TableSkeleton rows={3} cols={5} /> : best.slice(0, 5).map(u => (
              <div key={u.unitId} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) repeat(4,minmax(84px,1fr))', gap: 14, alignItems: 'center', minHeight: 52, padding: '7px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{u.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.propertyName}</span>
                </div>
                <div style={{ textAlign: 'right', fontSize: 13 }}>{u.occupancy.toFixed(1)}%</div>
                <div style={{ textAlign: 'right', fontSize: 13 }}>{rm(u.adr, { cents: false })}</div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>{rm(u.revenue, { cents: false })}</div>
                <div style={{ textAlign: 'right', fontSize: 13 }}>{u.rating?.toFixed(2) ?? '\u2014'}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
