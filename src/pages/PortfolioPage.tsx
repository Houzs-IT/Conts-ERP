import { color, text } from '../theme';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import type { Tone, UnitReadiness } from '../lib/types';

const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};

interface Unit {
  unitId: string; unitNumber: string; propertyName: string; ownerName: string;
  readiness: UnitReadiness; occupancy: number; adr: number; revpar: number;
  revenue: number; rating: number | null;
}
interface Payload { units: Unit[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  units: [
    { unitId: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', ownerName: 'Lim Chee Keong', readiness: 'occupied', occupancy: 94.1, adr: 28400, revpar: 26700, revenue: 812000, rating: 4.92 },
    { unitId: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', ownerName: 'Wong Mei Ling', readiness: 'cleaning', occupancy: 88.3, adr: 23100, revpar: 20400, revenue: 634000, rating: 4.88 },
    { unitId: 'u3', unitNumber: '#2207', propertyName: 'Tribeca', ownerName: 'Rajesh Kumar', readiness: 'ready', occupancy: 91.0, adr: 31800, revpar: 28900, revenue: 901000, rating: 4.95 },
    { unitId: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz', ownerName: 'Chong Wei Han', readiness: 'dirty', occupancy: 79.4, adr: 26500, revpar: 21000, revenue: 588000, rating: 4.79 },
    { unitId: 'u5', unitNumber: '#A-21-02', propertyName: 'The Establishment', ownerName: 'Nur Aisyah', readiness: 'dirty', occupancy: 85.2, adr: 24200, revpar: 20600, revenue: 672000, rating: 4.84 },
    { unitId: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', ownerName: 'Tan Boon Huat', readiness: 'maintenance', occupancy: 72.0, adr: 22800, revpar: 16400, revenue: 441000, rating: 4.71 },
  ],
};

const READY_LABEL = (r: string) => r[0].toUpperCase() + r.slice(1);
const COLS = 'minmax(190px,1.8fr) minmax(130px,1.1fr) minmax(110px,1fr) minmax(90px,0.8fr) minmax(90px,0.8fr) minmax(100px,0.9fr) minmax(90px,0.8fr)';

export default function PortfolioPage() {
  const { data, loading, error, reload } = useApi<Payload>('/analytics', FALLBACK);
  const units = data?.units ?? [];
  const avgOcc = units.length ? (units.reduce((s, u) => s + u.occupancy, 0) / units.length).toFixed(1) : '0.0';
  const avgAdr = units.length ? Math.round(units.reduce((s, u) => s + u.adr, 0) / units.length) : 0;
  const buildings = new Set(units.map(u => u.propertyName)).size;

  return (
    <>
      <PageHeader title="Portfolio" sub={`${units.length} units &middot; ${buildings} buildings &middot; ${avgOcc}% average occupancy &middot; ${rm(avgAdr, { cents: false })} average ADR`} />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <Card>
        <CardHeader title="Every unit, this month to date" />
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 940 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Unit</div><div>Owner</div><div>Readiness</div>
              <div style={{ textAlign: 'right' }}>Occupancy</div><div style={{ textAlign: 'right' }}>ADR</div>
              <div style={{ textAlign: 'right' }}>Revenue</div><div style={{ textAlign: 'right' }}>Rating</div>
            </div>
            {loading && units.length === 0 ? <TableSkeleton rows={6} cols={7} /> : units.map(u => (
              <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}`}
                style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '8px 22px', borderBottom: `1px solid ${color.borderMuted}`, textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{u.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.propertyName}</span>
                </div>
                <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.ownerName}</span>
                <div><Badge tone={READY_TONE[u.readiness] ?? 'neutral'} label={READY_LABEL(u.readiness)} /></div>
                <span style={{ fontSize: 13, textAlign: 'right' }}>{u.occupancy.toFixed(1)}%</span>
                <span style={{ fontSize: 13, textAlign: 'right' }}>{rm(u.adr, { cents: false })}</span>
                <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 500 }}>{rm(u.revenue, { cents: false })}</span>
                <span style={{ fontSize: 13, textAlign: 'right' }}>{u.rating?.toFixed(2) ?? '\u2014'}</span>
              </a>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
