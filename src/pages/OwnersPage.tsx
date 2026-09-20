import { color, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';

interface Owner {
  id: string; displayName: string; email: string; unitsLabel: string;
  unitCount: number; managementFeePct: number; monthRevenue: number; renewsOn: string | null;
}
interface Payload { data: Owner[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'o1', displayName: 'Lim Chee Keong', email: 'limck@example.com', unitsLabel: 'Vista Jaya One #A-12-03', unitCount: 1, managementFeePct: 25, monthRevenue: 812000, renewsOn: '2027-03-01' },
    { id: 'o2', displayName: 'Wong Mei Ling', email: 'wongml@example.com', unitsLabel: 'Arcoris #B-08-11', unitCount: 1, managementFeePct: 25, monthRevenue: 634000, renewsOn: '2027-06-01' },
    { id: 'o3', displayName: 'Rajesh Kumar', email: 'rajesh@example.com', unitsLabel: 'Tribeca #2207', unitCount: 1, managementFeePct: 25, monthRevenue: 901000, renewsOn: '2026-11-01' },
    { id: 'o4', displayName: 'Chong Wei Han', email: 'chongwh@example.com', unitsLabel: 'Scarletz #15-06', unitCount: 1, managementFeePct: 25, monthRevenue: 588000, renewsOn: '2027-08-01' },
    { id: 'o5', displayName: 'Nur Aisyah', email: 'aisyah@example.com', unitsLabel: 'The Establishment #A-21-02', unitCount: 1, managementFeePct: 25, monthRevenue: 672000, renewsOn: '2028-09-04' },
    { id: 'o6', displayName: 'Tan Boon Huat', email: 'tanbh@example.com', unitsLabel: 'Sentral Suites #C-31-14', unitCount: 1, managementFeePct: 25, monthRevenue: 441000, renewsOn: '2027-01-15' },
  ],
};

const COLS = 'minmax(170px,1.5fr) minmax(190px,1.7fr) minmax(90px,0.8fr) minmax(110px,1fr) minmax(110px,1fr)';

export default function OwnersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/owners', FALLBACK);
  const rows = data?.data ?? [];
  const units = rows.reduce((s, o) => s + o.unitCount, 0);

  return (
    <>
      <PageHeader title="Owners" sub={`${rows.length} owners · ${units} units under management`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Owner</div><div>Units</div><div style={{ textAlign: 'right' }}>Fee</div><div style={{ textAlign: 'right' }}>This month</div><div>Contract</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={5} /> : rows.map(o => (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}`, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 999, background: color.black, color: color.gold, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
                    {o.displayName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.displayName}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.email}</span>
                  </div>
                </div>
                <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.unitsLabel}</span>
                <span style={{ fontSize: 13, textAlign: 'right' }}>{o.managementFeePct}%</span>
                <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 500 }}>{rm(o.monthRevenue, { cents: false })}</span>
                <span style={{ fontSize: 12.5, color: color.textMuted }}>{o.renewsOn ? `Renews ${o.renewsOn}` : '\u2014'}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
