import { color, radius } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ChannelMark from '../components/ChannelMark';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import type { BookingChannel } from '../lib/types';

interface Review {
  id: string; guestName: string; unitNumber: string; propertyName: string;
  channel: BookingChannel; rating: number; comment: string | null; reviewedAt: string;
}
interface Payload { data: Review[]; average: number | null; generatedAt: string }

const FALLBACK: Payload = {
  average: 4.75, generatedAt: '',
  data: [
    { id: 'r1', guestName: 'Nadia A.', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', rating: 5, comment: 'Spotless and exactly as described. Check-in instructions were clear.', reviewedAt: '2026-09-14' },
    { id: 'r2', guestName: 'Jonathan T.', unitNumber: '#B-08-11', propertyName: 'Arcoris', channel: 'airbnb', rating: 5, comment: 'Great location, quick responses from the host.', reviewedAt: '2026-09-12' },
    { id: 'r3', guestName: 'Marcus W.', unitNumber: '#2207', propertyName: 'Tribeca', channel: 'booking_com', rating: 5, comment: 'Best value in Bukit Bintang. Would stay again.', reviewedAt: '2026-09-10' },
    { id: 'r4', guestName: 'Chen Y.', unitNumber: '#15-06', propertyName: 'Scarletz', channel: 'agoda', rating: 4, comment: 'Comfortable, but the aircon was a little loud at night.', reviewedAt: '2026-09-05' },
  ],
};

function Stars({ n }: { n: number }) {
  return (
    <span style={{ display: 'flex', gap: 2 }} aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => <Icon key={i} name="Star" size="sm" color={i <= n ? color.gold : color.border} />)}
    </span>
  );
}

export default function ReviewsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/reviews', FALLBACK);
  const rows = data?.data ?? [];

  return (
    <>
      <PageHeader title="Reviews" sub={`${data?.average ?? '\u2014'} average across ${rows.length} reviews`} />

      {error && <StaleBanner message={`Showing the last reviews we have. ${error}`} onRetry={reload} />}

      {loading && rows.length === 0 ? <Card><TableSkeleton rows={4} cols={3} /></Card> : rows.map(r => (
        <Card key={r.id}>
          <div style={{ padding: '15px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <ChannelMark ch={r.channel} size={22} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.guestName}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>{r.propertyName} {r.unitNumber} · {r.reviewedAt}</span>
                </div>
              </div>
              <Stars n={r.rating} />
            </div>
            {r.comment && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, textWrap: 'pretty' }}>{r.comment}</p>}
            <button style={{ alignSelf: 'flex-start', height: 34, padding: '0 13px', borderRadius: radius.control, border: `1px solid ${color.gold}`, background: 'transparent', color: color.goldInk, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              Write a reply
            </button>
          </div>
        </Card>
      ))}
    </>
  );
}
