import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import { channel as CH } from '../theme';
import type { Tone, BookingChannel } from '../lib/types';

interface Rate { channel: BookingChannel; weekday: number; weekend: number; sync: { label: string; tone: Tone } }
interface Unit { unitId: string; unitNumber: string; propertyName: string; baseRate: number; rates: Rate[] }
interface Payload { units: Unit[]; weekendMultiplier: number; generatedAt: string }

const mk = (unitId: string, unitNumber: string, propertyName: string, base: number): Unit => ({
  unitId, unitNumber, propertyName, baseRate: base,
  rates: [
    { channel: 'direct', weekday: base, weekend: Math.round(base * 1.22), sync: { label: 'No commission', tone: 'neutral' } },
    { channel: 'airbnb', weekday: Math.round(base * 1.12), weekend: Math.round(base * 1.12 * 1.22), sync: { label: 'Synced', tone: 'success' } },
    { channel: 'booking_com', weekday: Math.round(base * 1.18), weekend: Math.round(base * 1.18 * 1.22), sync: { label: 'Synced', tone: 'success' } },
    { channel: 'agoda', weekday: Math.round(base * 1.16), weekend: Math.round(base * 1.16 * 1.22), sync: { label: 'Expired', tone: 'critical' } },
  ],
});

const FALLBACK: Payload = {
  weekendMultiplier: 1.22, generatedAt: '',
  units: [
    mk('u1', '#A-12-03', 'Vista Jaya One', 28400),
    mk('u2', '#B-08-11', 'Arcoris Mont Kiara', 23100),
    mk('u3', '#2207', 'Tribeca', 31800),
    mk('u4', '#15-06', 'Scarletz', 26500),
  ],
};

const COLS = 'minmax(170px,1.6fr) minmax(110px,1fr) minmax(110px,1fr) minmax(130px,1fr)';

export default function PricingPage() {
  const { data, loading, error, reload } = useApi<Payload>('/pricing', FALLBACK);
  const units = data?.units ?? [];
  const weekendPct = Math.round(((data?.weekendMultiplier ?? 1.22) - 1) * 100);

  return (
    <>
      <PageHeader title="Pricing" sub={`Base rate per unit, then the uplift each channel carries. Weekend adds ${weekendPct}%.`} />

      {error && <StaleBanner message={`Showing the last rates we have. ${error}`} onRetry={reload} />}

      {loading && units.length === 0 ? <Card><TableSkeleton rows={4} cols={4} /></Card> : units.map(u => (
        <Card key={u.unitId}>
          <div style={{ padding: '15px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{u.propertyName} {u.unitNumber}</span>
              <span style={{ fontSize: text.small, color: color.textMuted }}>Base web rate {rm(u.baseRate, { cents: false })} per night</span>
            </div>
            <button style={{ height: 34, padding: '0 13px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: '#FFFFFF', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
              Edit rates
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 20px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.micro, fontWeight: 600, letterSpacing: '0.05em', color: color.textMuted }}>
            <div>CHANNEL</div><div style={{ textAlign: 'right' }}>WEEKDAY</div><div style={{ textAlign: 'right' }}>WEEKEND</div><div>SYNC</div>
          </div>

          {u.rates.map(r => (
            <div key={r.channel} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 48, padding: '8px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <ChannelMark ch={r.channel} size={20} />
                <span style={{ fontSize: 13 }}>{CH[r.channel].label}</span>
              </div>
              <span style={{ fontSize: 13, textAlign: 'right' }}>{rm(r.weekday, { cents: false })}</span>
              <span style={{ fontSize: 13, textAlign: 'right', color: color.textMuted }}>{rm(r.weekend, { cents: false })}</span>
              <div><Badge tone={r.sync.tone} label={r.sync.label} /></div>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
