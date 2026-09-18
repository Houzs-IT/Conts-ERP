import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';

interface Unit {
  unitId: string; unitNumber: string; propertyName: string;
  occupancy: number; adr: number; revpar: number; revenue: number; rating: number | null;
}
interface Payload {
  series: { period: string; revenue: number; nights: number; adr: number }[];
  units: Unit[]; best: Unit[]; weakest: Unit[];
  currency: string; generatedAt: string;
}

const FALLBACK: Payload = {
  currency: 'MYR', generatedAt: '',
  series: [
    { period: '2026-04', revenue: 9600000, nights: 387, adr: 24800 },
    { period: '2026-05', revenue: 10400000, nights: 406, adr: 25600 },
    { period: '2026-06', revenue: 11200000, nights: 418, adr: 26800 },
    { period: '2026-07', revenue: 10800000, nights: 412, adr: 26200 },
    { period: '2026-08', revenue: 11600000, nights: 428, adr: 27100 },
    { period: '2026-09', revenue: 12200000, nights: 442, adr: 27600 },
  ],
  units: [], best: [], weakest: [],
};

const METRICS = {
  revenue: { label: 'Revenue', pick: (s: Payload['series'][0]) => s.revenue, fmt: (v: number) => rm(v, { cents: false }) },
  nights: { label: 'Occupied nights', pick: (s: Payload['series'][0]) => s.nights, fmt: (v: number) => String(v) },
  adr: { label: 'ADR', pick: (s: Payload['series'][0]) => s.adr, fmt: (v: number) => rm(v, { cents: false }) },
} as const;

const monthLabel = (p: string) => new Date(p + '-01').toLocaleDateString('en-MY', { month: 'short' });

export default function AnalyticsPage() {
  const [metric, setMetric] = useState<keyof typeof METRICS>('revenue');
  const { data, loading, error, reload } = useApi<Payload>('/analytics?months=6', FALLBACK);

  const m = METRICS[metric];
  const series = data?.series ?? [];
  const values = series.map(m.pick);
  const max = Math.max(1, ...values);

  return (
    <>
      <PageHeader title="Analytics" sub="Last 6 months &middot; collected revenue, not gross booking value" />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <Card style={{ padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>{m.label}</span>
            <div style={{ display: 'flex', border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}>
              {(Object.keys(METRICS) as (keyof typeof METRICS)[]).map(k => (
                <button key={k} onClick={() => setMetric(k)}
                  style={{ padding: '7px 13px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: 'none', font: 'inherit',
                    background: k === metric ? color.black : '#FFFFFF', color: k === metric ? '#FFFFFF' : color.textMuted }}>
                  {METRICS[k].label}
                </button>
              ))}
            </div>
          </div>
          {loading && series.length === 0 ? <div className="skeleton" style={{ height: 200 }} /> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 200 }}>
              {series.map((s, i) => {
                const v = m.pick(s);
                return (
                  <div key={s.period} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 8, height: '100%' }}>
                    <span style={{ fontSize: text.small, fontWeight: 600 }}>{m.fmt(v)}</span>
                    <div style={{ width: '100%', borderRadius: '6px 6px 0 0', height: Math.round((v / max) * 140), background: i === series.length - 1 ? color.gold : color.charcoal }} />
                    <span style={{ fontSize: text.micro, color: color.textMuted }}>{monthLabel(s.period)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
        {[{ title: 'Strongest occupancy', rows: data?.best ?? [] }, { title: 'Needs a pricing review', rows: data?.weakest ?? [] }].map(g => (
          <Card key={g.title}>
            <CardHeader title={g.title} />
            {loading && g.rows.length === 0 ? <TableSkeleton rows={3} cols={2} /> : g.rows.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: color.textMuted }}>Not enough data for this period.</div>
            ) : g.rows.map(u => (
              <div key={u.unitId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '12px 20px', borderTop: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{u.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.propertyName}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flex: 'none' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{u.occupancy.toFixed(1)}%</span>
                  <span style={{ fontSize: 12, color: color.textMuted }}>{rm(u.adr, { cents: false })}</span>
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </>
  );
}
