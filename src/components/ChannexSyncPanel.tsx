import { mayWork } from '../lib/areaAccess';
import { useEffect, useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';
import { PageControls } from './PageControls';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { date, timeWithZone } from '../lib/format';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';

interface Call { kind: string; calledAt: string; status: number; taskId: string | null; rows: number; fullSync: boolean; unit: string | null }
interface Status { notifications?: { secretSet: boolean; registered: boolean | null } | null; configured: boolean; restricted?: boolean; linkedUnits: number; queued: number; failed: number; oldestQueuedAt: string | null; recentCalls: Call[]; callsTotal?: number }

/** Channex sync health: units linked, updates waiting or failed, the last calls with Channex's task
 *  ids, and a full sync (500 days, two calls) for going live or recovering after an outage. */
export type ChannexState = 'connected' | 'not_connected' | 'attention';

export default function ChannexSyncPanel({ onState }: { onState?: (state: ChannexState | null) => void } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { data, reload } = useApi<Status>(`/integrations/channex/status?page=${page}&pageSize=${pageSize}`);
  const toast = useToast();
  const { user } = useSession();
  const canRun = mayWork(user, 'integrations');
  const [busy, setBusy] = useState(false);
  const [hookBusy, setHookBusy] = useState(false);
  const [confirmDialog, ask] = useConfirm();
  const state: ChannexState | null = !data || data.restricted ? null : !data.configured ? 'not_connected' : data.failed ? 'attention' : 'connected';
  useEffect(() => { onState?.(state); }, [state, onState]);
  if (!data || data.restricted) return null;
  const n = data.notifications;
  const shown = data.recentCalls;
  const callsTotal = data.callsTotal ?? data.recentCalls.length;

  async function fullSync() {
    const ok = await ask({
      title: 'Send everything to the channels again?',
      body: 'Prices and open nights for the next 500 days are resent to Airbnb, Booking.com and every other channel, for every unit set up in Channex.',
      meta: `${data?.linkedUnits ?? 0} ${data?.linkedUnits === 1 ? 'unit' : 'units'} set up in Channex`,
      confirmLabel: 'Send everything', danger: false,
    });
    if (ok === null) return;
    setBusy(true);
    try {
      const r = await api.post<{ units: number; sent: { availability?: { status: number }; restrictions?: { status: number } } }>('/integrations/channex/full-sync', {});
      const ok = [r.sent.availability?.status, r.sent.restrictions?.status].every(s => s !== undefined && s >= 200 && s < 300);
      toast(ok
        ? { tone: 'success', title: 'Everything sent again.', body: `500 days for ${r.units} ${r.units === 1 ? 'unit, in two calls' : 'units, two calls each'}.` }
        : { tone: 'warning', title: 'Waiting to send.', body: 'Channex did not take it straight away. It is sent again automatically.' });
      reload();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  // Channex tells Conts about new, changed and cancelled bookings through one registered address per site.
  async function turnOnNotifications() {
    setHookBusy(true);
    try {
      await api.post('/integrations/channex-webhook-setup', {});
      toast({ tone: 'success', title: 'Live updates are on.', body: 'Channex now sends new, changed and cancelled reservations to this site.' });
      reload();
    } catch (e) { notifyFailure(e); } finally { setHookBusy(false); }
  }

  return (
    <Card>
      {confirmDialog}
      <div className="pt-[18px] px-[22px] pb-[14px] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-title font-semibold">Channex updates</span>
          <StatusBadge tone={!data.configured ? 'neutral' : data.failed ? 'critical' : data.queued ? 'warning' : 'success'}
            label={!data.configured ? 'Not connected' : data.failed ? `${data.failed} not sent` : data.queued ? `${data.queued} waiting to send` : 'Up to date'} />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={reload}>Refresh</Button>
          {canRun && data.configured && <Button size="sm" variant="primary" loading={busy} disabled={!data.linkedUnits} disabledReason="Set a unit up in Channex first" onClick={() => void fullSync()}>Send everything again</Button>}
        </div>
      </div>
      <div className="px-[22px] pb-3 text-copy text-muted-ink">
        {data.configured
          ? `${data.linkedUnits} ${data.linkedUnits === 1 ? 'unit' : 'units'} linked. Changes are sent in batches a few seconds after the last edit, and retried if Channex is busy.`
          : 'Channex is not connected on this environment yet. Management adds the Channex key (CHANNEX_API_KEY) once in Cloudflare; then units can be connected from their Channels card.'}
      </div>
      {n && n.registered === false && (
        <div className="mx-[22px] mb-3 p-3 rounded-card border border-solid border-line bg-page flex items-center justify-between gap-3 flex-wrap text-copy">
          <span>{n.secretSet
            ? 'Live updates are off. Channex is not sending reservations to this site yet.'
            : 'Live updates cannot be turned on yet: the notification secret (CHANNEX_WEBHOOK_SECRET) is not set on this site.'}</span>
          {n.secretSet && <Button size="sm" variant="primary" loading={hookBusy} onClick={() => void turnOnNotifications()}>Turn on live updates</Button>}
        </div>
      )}
      {n && n.registered === true && <div className="px-[22px] pb-3 text-copy text-muted-ink">Live updates are on.</div>}
      {data.recentCalls.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[640px]">
            <thead><tr className="bg-muted">{['Sent', 'Unit', 'What', 'Changes', 'Result', 'Channex task id'].map(h => <th key={h} className="py-2 px-[22px] text-left text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((c, i) => {
                const ok = c.status >= 200 && c.status < 300;
                return (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft)]">
                    <td className="py-2 px-[22px] text-copy whitespace-nowrap">{date(c.calledAt)} · {timeWithZone(c.calledAt)}</td>
                    <td className="py-2 px-[22px] text-copy">{c.unit ?? '—'}</td>
                    <td className="py-2 px-[22px] text-copy">{c.kind === 'availability' ? 'Availability' : 'Prices and restrictions'}{c.fullSync ? ' (all 500 days)' : ''}</td>
                    <td className="py-2 px-[22px] text-copy tabular-nums">{c.rows}</td>
                    <td className={cx('py-2 px-[22px] text-copy', ok ? 'text-[var(--color-ink-2)]' : 'text-danger')}>{ok ? 'Accepted' : c.status === 429 ? 'Busy, retrying' : c.status === 0 ? 'No connection, retrying' : `Refused (${c.status})`}</td>
                    <td className="py-2 px-[22px] text-meta whitespace-nowrap [font-family:var(--font-mono,ui-monospace,monospace)] select-all">{c.taskId ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {callsTotal > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap pl-[22px] [border-top:1px_solid_var(--color-line-soft)]">
          <div className="flex items-center gap-1" role="group" aria-label="Rows per page">
            {[10, 50, 100].map(s => (
              <Button key={s} size="sm" variant={s === pageSize ? 'primary' : 'secondary'} aria-pressed={s === pageSize}
                onClick={() => { setPageSize(s); setPage(1); }}>{s}</Button>
            ))}
          </div>
          <PageControls page={page} pageSize={pageSize} total={callsTotal} onPage={setPage} noun="sends" />
        </div>
      )}
    </Card>
  );
}
