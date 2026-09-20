import { color } from '../theme';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';

interface Payload {
  organisation: { legalName: string; companyNumber: string; address: string; supportPhone: string };
  locale: { default: string; timezone: string; currency: string };
  finance: { defaultManagementFeePct: number; statementPeriod: string };
  operations: { checkIn: string; checkOut: string; turnoverSlaHours: number; photoRequiredToMarkReady: boolean };
  generatedAt: string;
}

const FALLBACK: Payload = {
  generatedAt: '',
  organisation: {
    legalName: 'The Conts Sdn Bhd',
    companyNumber: '202301027399 (1521322-V)',
    address: 'C-41-06, Jaya One, Jalan Universiti, 46200 Petaling Jaya',
    supportPhone: '+60 17-465 8868',
  },
  locale: { default: 'en-MY', timezone: 'Asia/Kuala_Lumpur', currency: 'MYR' },
  finance: { defaultManagementFeePct: 25, statementPeriod: 'Calendar month, finalised on the 1st' },
  operations: { checkIn: '15:00', checkOut: '11:00', turnoverSlaHours: 4, photoRequiredToMarkReady: true },
};

export default function SettingsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/settings', FALLBACK);
  const d = data ?? FALLBACK;

  const groups: { title: string; rows: [string, string][] }[] = [
    { title: 'Organisation', rows: [
      ['Legal name', d.organisation.legalName],
      ['Company number', d.organisation.companyNumber],
      ['Registered address', d.organisation.address],
      ['Support phone', d.organisation.supportPhone],
    ] },
    { title: 'Locale and finance', rows: [
      ['Default locale', d.locale.default],
      ['Timezone', d.locale.timezone],
      ['Currency', `${d.locale.currency}, shown as RM`],
      ['Default management fee', `${d.finance.defaultManagementFeePct}%`],
      ['Statement period', d.finance.statementPeriod],
    ] },
    { title: 'Operations defaults', rows: [
      ['Standard check-in', d.operations.checkIn],
      ['Standard check-out', d.operations.checkOut],
      ['Turnover SLA', `${d.operations.turnoverSlaHours} hours before next check-in`],
      ['Photo required to mark ready', d.operations.photoRequiredToMarkReady ? 'Yes' : 'No'],
    ] },
  ];

  return (
    <>
      <PageHeader title="Settings" sub="Organisation-wide defaults. Every change is audited." />

      {error && <StaleBanner message={`Showing the last settings we have. ${error}`} onRetry={reload} />}

      {loading && !data ? <Card><TableSkeleton rows={4} cols={2} /></Card> : groups.map(g => (
        <Card key={g.title}>
          <CardHeader title={g.title} />
          {g.rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: '13px 20px', borderTop: `1px solid ${color.borderMuted}`, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: color.textMuted }}>{k}</span>
              <span style={{ fontSize: 13.5, fontWeight: 500, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
