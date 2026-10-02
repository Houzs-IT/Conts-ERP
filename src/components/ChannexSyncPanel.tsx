import { useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from './Toast';
import { date, timeWithZone } from '../lib/format';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';

interface Call { kind: string; calledAt: string; status: number; taskId: string | null; rows: number; fullSync: boolean; unit: string | null }
interface Status { notifications?: { secretSet: boolean; registered: boolean | null } | null; configured: boolean; restricted?: boolean; linkedUnits: number; queued: number; failed: number; oldestQueuedAt: string | null; recentCalls: Call[] }

/** Channex sync health: units linked, updates waiting or failed, the last calls with Channex's task
 *  ids, and a full sync (500 days, two calls) for going live or recovering after an outage. */
export default function ChannexSyncPanel() {
  const { data, reload } = useApi<Status>('/integrations/channex/status');
  const toast = useToast();
  const { user } = useSession();
  const canRun = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [busy, setBusy] = useState(false);
  const [hookBusy, setHookBusy] = useState(false);
  if (!data || data.restricted) return null;
  const n = data.notifications;

  async function fullSync() {
    setBusy(true);
    try {
      const r = await api.post<{ units: number; sent: { availability?: { status: number }; restrictions?: { status: number } } }>('/integrations/channex/full-sync', {});
      const ok = [r.sent.availability?.status, r.sent.restrictions?.status].every(s => s !== undefined && s >= 200 && s < 300);
      toast(ok
        ? { tone: 'success', title: 'Full sync sent.', body: `500 days for ${r.units} ${r.units === 1 ? 'unit, in two calls' : 'units, two calls each'}.` }
        : { tone: 'warning', title: 'Full sync queued.', body: 'Channex did not take it straight away. It is retried automatically.' });
      reload();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  // Channex tells Conts about new, changed and cancelled bookings through one registered address per site.
  async function turnOnNotifications() {
    setHookBusy(true);
    try {
      await api.post('/integrations/channex-webhook-setup', {});
      toast({ tone: 'success', title: 'Booking notifications are on.', body: 'Channex now sends new, changed and cancelled bookings to this site.' });
      reload();
    } catch (e) { notifyFailure(e); } finally { setHookBusy(false); }
  }

  return (
    <Card>
      <div className="pt-[18px] px-[22px] pb-[14px] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-[18px] font-semibold">Channex sync</span>
          <Badge tone={!data.configured ? 'neutral' : data.failed ? 'critical' : data.queued ? 'warning' : 'success'}
            label={!data.configured ? 'Not connected' : data.failed ? `${data.failed} failed` : data.queued ? `${data.queued} waiting` : 'Up to date'} />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={reload}>Refresh</Button>
          {canRun && data.configured && <Button size="sm" variant="primary" loading={busy} disabled={!data.linkedUnits} disabledReason="Set a unit up in Channex first" onClick={() => void fullSync()}>Full sync</Button>}
        </div>
      </div>
      <div className="px-[22px] pb-3 text-[13px] text-muted-ink">
        {data.configured
          ? `${data.linkedUnits} ${data.linkedUnits === 1 ? 'unit' : 'units'} linked. Changes are sent in batches a few seconds after the last edit, and retried if Channex is busy.`
          : 'Channex is not connected on this environment yet.'}
      </div>
      {n && n.registered === false && (
        <div className="mx-[22px] mb-3 p-3 rounded-card border border-solid border-line bg-page flex items-center justify-between gap-3 flex-wrap text-[13px]">
          <span>{n.secretSet
            ? 'Booking notifications are off. Channex is not sending bookings to this site yet.'
            : 'Booking notifications cannot be turned on yet: the notification secret (CHANNEX_WEBHOOK_SECRET) is not set on this site.'}</span>
          {n.secretSet && <Button size="sm" variant="primary" loading={hookBusy} onClick={() => void turnOnNotifications()}>Turn on booking notifications</Button>}
        </div>
      )}
      {n && n.registered === true && <div className="px-[22px] pb-3 text-[12.5px] text-muted-ink">Booking notifications are on.</div>}
      {data.recentCalls.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[640px]">
            <thead><tr className="bg-muted">{['Sent', 'Unit', 'What', 'Changes', 'Result', 'Channex task id'].map(h => <th key={h} className="py-2 px-[22px] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink">{h}</th>)}</tr></thead>
            <tbody>
              {data.recentCalls.map((c, i) => {
                const ok = c.status >= 200 && c.status < 300;
                return (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft)]">
                    <td className="py-2 px-[22px] text-[12.5px] whitespace-nowrap">{date(c.calledAt)} · {timeWithZone(c.calledAt)}</td>
                    <td className="py-2 px-[22px] text-[12.5px]">{c.unit ?? '—'}</td>
                    <td className="py-2 px-[22px] text-[12.5px]">{c.kind === 'availability' ? 'Availability' : 'Prices and restrictions'}{c.fullSync ? ' (full sync)' : ''}</td>
                    <td className="py-2 px-[22px] text-[12.5px] tabular-nums">{c.rows}</td>
                    <td className={cx('py-2 px-[22px] text-[12.5px]', ok ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-text-critical,#B42318)]')}>{ok ? 'Accepted' : c.status === 429 ? 'Busy, retrying' : c.status === 0 ? 'No connection, retrying' : `Refused (${c.status})`}</td>
                    <td className="py-2 px-[22px] text-[12px] whitespace-nowrap [font-family:var(--font-mono,ui-monospace,monospace)] select-all">{c.taskId ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
