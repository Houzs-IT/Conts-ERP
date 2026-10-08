import { useApi } from '../../lib/useApi';

interface ActivityEntry { actorLabel: string; action: string; source: string; occurredAt: string }
interface ActivityPayload { data: ActivityEntry[] }
const ACTIVITY_FALLBACK: ActivityPayload = {
  data: [
    { actorLabel: 'Channel sync', action: 'reservation.created', source: 'channel_webhook', occurredAt: '12 Sep 10:02' },
    { actorLabel: 'Aina Zulkifli', action: 'reservation.dates_change', source: 'web', occurredAt: '14 Sep 09:18' },
    { actorLabel: 'System', action: 'notification.sent', source: 'system', occurredAt: '14 Sep 09:18' },
  ],
};

/** Activity log — the reservation's audit trail (actor, action, source, time),
 *  read straight from `GET /api/audit?entityTable=reservations&entityId=`. */
export function ActivityLog({ reservationId }: { reservationId: string }) {
  const { data: audit } = useApi<ActivityPayload>(`/audit?entityTable=reservations&entityId=${reservationId}`, ACTIVITY_FALLBACK);
  const entries = audit?.data ?? [];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold text-muted-ink">Activity</span>
      {entries.length === 0 ? (
        <span className="text-[12px] text-muted-ink">No activity yet.</span>
      ) : (
        <div className="border border-solid border-line rounded-card overflow-hidden">
          {entries.map((a, i) => (
            <div key={i} className={`flex items-center gap-2.5 py-2 px-3 ${i < entries.length - 1 ? '[border-bottom:1px_solid_var(--color-line-soft)]' : ''}`}>
              <span className="w-[26px] h-[26px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-[10px] font-semibold">
                {a.actorLabel.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </span>
              <div className="flex flex-col gap-px flex-1 min-w-0">
                <span className="text-[12px]"><strong className="font-semibold">{a.actorLabel}</strong> · {a.action.replace(/[._]/g, ' ')}</span>
                <span className="text-[11px] text-muted-ink">{a.source.replace(/_/g, ' ')}</span>
              </div>
              <span className="text-[11px] text-muted-ink whitespace-nowrap">{a.occurredAt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
