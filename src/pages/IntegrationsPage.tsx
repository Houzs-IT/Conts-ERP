import { color, radius } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import type { IntegrationState, Tone } from '../lib/types';

const STATE_TONE: Record<IntegrationState, Tone> = {
  connected: 'success', expired: 'critical', degraded: 'warning', failed: 'critical',
};
const PROVIDER_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda',
  whatsapp: 'WhatsApp Business', maybank: 'Maybank',
};
/** Each state says what it means for the business, not what it means technically. */
const STATE_NOTE: Record<IntegrationState, string> = {
  connected: 'Syncing normally.',
  expired: 'Reconnect to resume syncing. New bookings are not arriving.',
  degraded: 'Syncing slowly. Some bookings may be delayed.',
  failed: 'Sync failed. Bookings are not arriving from this channel.',
};

interface Row { id: string; provider: string; state: IntegrationState; lastSyncedAt: string | null; lastError: string | null }
interface Payload { data: Row[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'i1', provider: 'airbnb', state: 'connected', lastSyncedAt: '2026-09-16 14:06', lastError: null },
    { id: 'i2', provider: 'booking_com', state: 'connected', lastSyncedAt: '2026-09-16 13:58', lastError: null },
    { id: 'i3', provider: 'agoda', state: 'expired', lastSyncedAt: '2026-09-09 12:00', lastError: 'Access token expired' },
    { id: 'i4', provider: 'whatsapp', state: 'connected', lastSyncedAt: '2026-09-16 14:05', lastError: null },
    { id: 'i5', provider: 'maybank', state: 'degraded', lastSyncedAt: '2026-09-15 22:00', lastError: 'Payout confirmations delayed' },
  ],
};

export default function IntegrationsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/integrations', FALLBACK);
  const rows = data?.data ?? [];
  const problems = rows.filter(r => r.state !== 'connected').length;

  return (
    <>
      <PageHeader title="Integrations" sub={`${rows.length} connections &middot; ${problems} needing attention`} />

      {error && <StaleBanner message={`Showing the last status we have. ${error}`} onRetry={reload} />}

      <Card>
        {loading && rows.length === 0 ? <TableSkeleton rows={5} cols={3} /> : rows.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '15px 22px', borderBottom: `1px solid ${color.borderMuted}`, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 180 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{PROVIDER_LABEL[r.provider] ?? r.provider}</span>
              <span style={{ fontSize: 12, color: color.textMuted }}>{STATE_NOTE[r.state]}</span>
            </div>
            <span style={{ fontSize: 12, color: color.textMuted }}>Last sync {r.lastSyncedAt ?? 'never'}</span>
            <Badge tone={STATE_TONE[r.state]} label={r.state[0].toUpperCase() + r.state.slice(1)} />
            {r.state !== 'connected' && (
              <button style={{ height: 34, padding: '0 13px', borderRadius: radius.control, border: `1px solid ${color.gold}`, background: 'transparent', color: color.goldInk, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                Reconnect
              </button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
