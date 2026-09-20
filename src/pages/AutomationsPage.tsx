import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';

interface Rule { id: string; name: string; trigger: string; offsetHours: number | null; template: string; isActive: boolean }
interface Payload {
  data: Rule[];
  quietHours: { from: string; to: string; timezone: string; note: string };
  generatedAt: string;
}

const FALLBACK: Payload = {
  generatedAt: '',
  quietHours: { from: '22:00', to: '08:00', timezone: 'Asia/Kuala_Lumpur',
    note: 'Non-urgent guest and owner messages queue until 08:00. Check-in risk and payout failure override.' },
  data: [
    { id: 'a1', name: 'Booking confirmed', trigger: 'reservation.confirmed', offsetHours: 0, template: 'guest.booking_confirmed', isActive: true },
    { id: 'a2', name: 'Pre-arrival details', trigger: 'reservation.check_in', offsetHours: -48, template: 'guest.pre_arrival', isActive: true },
    { id: 'a3', name: 'Access code', trigger: 'unit.ready', offsetHours: -2, template: 'guest.access_details', isActive: true },
    { id: 'a4', name: 'Check-out reminder', trigger: 'reservation.check_out', offsetHours: -12, template: 'guest.checkout_reminder', isActive: true },
    { id: 'a5', name: 'Review request', trigger: 'reservation.checked_out', offsetHours: 24, template: 'guest.review_request', isActive: true },
    { id: 'a6', name: 'Owner statement ready', trigger: 'statement.sent', offsetHours: 0, template: 'owner.statement_ready', isActive: true },
    { id: 'a7', name: 'Approval reminder', trigger: 'maintenance.waiting', offsetHours: 48, template: 'owner.approval_reminder', isActive: false },
  ],
};

const timing = (h: number | null) =>
  h === null || h === 0 ? 'Immediate' : h < 0 ? `${Math.abs(h)} hours before` : `${h} hours after`;

export default function AutomationsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/automations', FALLBACK);
  const toast = useToast();
  const rules = data?.data ?? [];
  const on = rules.filter(r => r.isActive).length;

  async function toggle(r: Rule) {
    try {
      await api.patch('/automations', { id: r.id, isActive: !r.isActive });
      toast.push({
        tone: r.isActive ? 'warning' : 'success',
        title: r.isActive ? `${r.name} paused.` : `${r.name} active.`,
        body: r.isActive ? 'No further messages will be sent from this rule.' : 'It will send on the next matching trigger.',
      });
      reload();
    } catch (e) {
      toast.push({ tone: 'critical', title: 'Could not change that rule.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
    }
  }

  return (
    <>
      <PageHeader title="Automations" sub={`${on} of ${rules.length} active · quiet hours ${data?.quietHours.from}\u2013${data?.quietHours.to} MYT`} />

      {error && <StaleBanner message={`Showing the last rules we have. ${error}`} onRetry={reload} />}

      {data?.quietHours && (
        <div style={{ padding: '11px 14px', borderRadius: radius.control, background: color.goldTint, border: `1px solid ${color.gold200}`, fontSize: text.small, color: color.goldInk, textWrap: 'pretty' }}>
          {data.quietHours.note}
        </div>
      )}

      <Card>
        {loading && rules.length === 0 ? <TableSkeleton rows={6} cols={3} /> : rules.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '15px 20px', borderBottom: `1px solid ${color.borderMuted}`, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                <Badge tone={r.isActive ? 'success' : 'neutral'} label={r.isActive ? 'Active' : 'Paused'} />
              </div>
              <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{r.trigger}</span>
              <span style={{ fontSize: 12.5, color: color.textMuted }}>{timing(r.offsetHours)} · {r.template}</span>
            </div>
            <button role="switch" aria-checked={r.isActive} aria-label={`${r.isActive ? 'Pause' : 'Activate'} ${r.name}`}
              onClick={() => toggle(r)}
              style={{ width: 44, height: 26, flex: 'none', borderRadius: radius.pill, border: 'none', cursor: 'pointer', padding: 3,
                display: 'flex', justifyContent: r.isActive ? 'flex-end' : 'flex-start',
                background: r.isActive ? '#11694A' : color.borderStrong, transition: 'background 120ms ease-out' }}>
              <span style={{ width: 20, height: 20, borderRadius: 999, background: '#FFFFFF' }} />
            </button>
          </div>
        ))}
      </Card>
    </>
  );
}
