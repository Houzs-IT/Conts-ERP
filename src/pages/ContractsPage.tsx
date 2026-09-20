import { color, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import type { Tone } from '../lib/types';

interface Contract {
  id: string; ownerName: string; unitsLabel: string; managementFeePct: number;
  startsOn: string; renewsOn: string | null; daysToRenewal: number | null; state: string;
}
interface Payload { data: Contract[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'c1', ownerName: 'Lim Chee Keong', unitsLabel: 'Vista Jaya One #A-12-03', managementFeePct: 25, startsOn: '2025-03-01', renewsOn: '2027-03-01', daysToRenewal: 164, state: 'Renewing soon' },
    { id: 'c2', ownerName: 'Wong Mei Ling', unitsLabel: 'Arcoris #B-08-11', managementFeePct: 25, startsOn: '2025-06-01', renewsOn: '2027-06-01', daysToRenewal: 256, state: 'Active' },
    { id: 'c3', ownerName: 'Rajesh Kumar', unitsLabel: 'Tribeca #2207', managementFeePct: 25, startsOn: '2024-11-01', renewsOn: '2026-11-01', daysToRenewal: 44, state: 'Renewing soon' },
    { id: 'c4', ownerName: 'Chong Wei Han', unitsLabel: 'Scarletz #15-06', managementFeePct: 25, startsOn: '2025-08-01', renewsOn: '2027-08-01', daysToRenewal: 317, state: 'Active' },
    { id: 'c5', ownerName: 'Nur Aisyah', unitsLabel: 'The Establishment #A-21-02', managementFeePct: 25, startsOn: '2026-09-04', renewsOn: '2028-09-04', daysToRenewal: 716, state: 'Active' },
    { id: 'c6', ownerName: 'Tan Boon Huat', unitsLabel: 'Sentral Suites #C-31-14', managementFeePct: 25, startsOn: '2025-01-15', renewsOn: '2027-01-15', daysToRenewal: 119, state: 'Renewing soon' },
  ],
};

const STATE_TONE: Record<string, Tone> = { Active: 'success', 'Renewing soon': 'warning', Ended: 'neutral' };
const COLS = 'minmax(160px,1.4fr) minmax(200px,1.8fr) minmax(80px,0.7fr) minmax(130px,1.1fr) minmax(130px,1.1fr) minmax(90px,0.8fr)';

export default function ContractsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/contracts', FALLBACK);
  const rows = data?.data ?? [];
  const soon = rows.filter(r => r.state === 'Renewing soon');

  return (
    <>
      <PageHeader title="Contracts" sub={`${rows.length} management agreements · ${soon.length} renewing within 6 months`} />

      {error && <StaleBanner message={`Showing the last agreements we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Owner</div><div>Units</div><div style={{ textAlign: 'right' }}>Fee</div><div>Started</div><div>Renews</div><div>Status</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={6} /> : rows.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Icon name="FileSignature" size="sm" color={color.textMuted} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ownerName}</span>
                </div>
                <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.unitsLabel}</span>
                <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 500 }}>{r.managementFeePct}%</span>
                <span style={{ fontSize: 12.5 }}>{r.startsOn}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 12.5 }}>{r.renewsOn ?? '\u2014'}</span>
                  {r.daysToRenewal !== null && r.daysToRenewal < 180 && (
                    <span style={{ fontSize: 11.5, color: '#8A5A12' }}>in {r.daysToRenewal} days</span>
                  )}
                </div>
                <div><Badge tone={STATE_TONE[r.state] ?? 'neutral'} label={r.state} /></div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
