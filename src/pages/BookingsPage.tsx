import { color, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm, dateRange } from '../lib/format';
import type { Tone, BookingChannel, ReservationState } from '../lib/types';

const STATE_TONE: Record<ReservationState, Tone> = {
  inquiry: 'neutral', pending: 'warning', confirmed: 'info', checked_in: 'success',
  checked_out: 'neutral', cancelled: 'neutral', no_show: 'critical',
};
const STATE_LABEL: Record<ReservationState, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in',
  checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
};

interface Row {
  id: string; externalRef: string | null; guestName: string; guestsCount: number;
  unitNumber: string; propertyName: string; channel: BookingChannel;
  state: ReservationState; checkIn: string; checkOut: string; grossBookingValue: number;
}
interface Payload { data: Row[]; total: number; page: number; generatedAt: string }

const FALLBACK: Payload = {
  total: 6, page: 1, generatedAt: '',
  data: [
    { id: 'b1', externalRef: 'ABNB-7741QK', guestName: 'Nadia Abdullah', guestsCount: 2, unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', state: 'checked_in', checkIn: '2026-09-13', checkOut: '2026-09-16', grossBookingValue: 85200 },
    { id: 'b2', externalRef: 'TC-2026-0916', guestName: 'Aaron Lee', guestsCount: 2, unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'direct', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-20', grossBookingValue: 113600 },
    { id: 'b3', externalRef: 'BDC-5512087', guestName: 'Priya Sundaram', guestsCount: 2, unitNumber: '#B-08-11', propertyName: 'Arcoris', channel: 'booking_com', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-23', grossBookingValue: 161700 },
    { id: 'b4', externalRef: 'AGD-330912', guestName: 'Chen Yu', guestsCount: 2, unitNumber: '#2207', propertyName: 'Tribeca', channel: 'agoda', state: 'confirmed', checkIn: '2026-09-11', checkOut: '2026-09-16', grossBookingValue: 159000 },
    { id: 'b5', externalRef: 'OWN-0032', guestName: 'Chong Wei Han', guestsCount: 2, unitNumber: '#15-06', propertyName: 'Scarletz', channel: 'owner_stay', state: 'confirmed', checkIn: '2026-09-23', checkOut: '2026-09-25', grossBookingValue: 0 },
    { id: 'b6', externalRef: 'MNT-0914', guestName: 'AquaFix Sdn Bhd', guestsCount: 0, unitNumber: '#C-31-14', propertyName: 'Sentral Suites', channel: 'maintenance_block', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-22', grossBookingValue: 0 },
  ],
};

const COLS = 'minmax(150px,1.3fr) minmax(170px,1.5fr) minmax(150px,1.3fr) minmax(150px,1.2fr) minmax(110px,0.9fr) minmax(110px,1fr)';

export default function BookingsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/reservations', FALLBACK);
  const rows = data?.data ?? [];

  return (
    <>
      <PageHeader title="Bookings" sub={`${data?.total ?? rows.length} reservations`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Reference</div><div>Guest</div><div>Unit</div><div>Dates</div><div style={{ textAlign: 'right' }}>Gross</div><div>Status</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={6} /> : rows.map(b => (
              <div key={b.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}`, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                  <ChannelMark ch={b.channel} size={20} />
                  <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.externalRef ?? '\u2014'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.guestName}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>{b.guestsCount > 0 ? `${b.guestsCount} guests` : 'No guest'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{b.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.propertyName}</span>
                </div>
                <div style={{ fontSize: 12.5 }}>{dateRange(b.checkIn, b.checkOut)}</div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>
                  {b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '\u2014'}
                </div>
                <div><Badge tone={STATE_TONE[b.state]} label={STATE_LABEL[b.state]} /></div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
