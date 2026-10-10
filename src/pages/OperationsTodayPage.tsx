import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner } from '../components/DataState';
import { Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { cx } from '../lib/design-tokens';
import type { BookingChannel } from '../lib/types';
import { Chip, Segmented, dayLabel, hm, mytDay, CATEGORY, type ChipTone } from '../components/ops/OpsUi';
import type { RepairOnDay } from './CleaningPage';

interface Arrival {
  reservationId: string; state: string; channel: string; guestName: string; guests: number; checkInTime: string; checkOut: string;
  unitId: string; unitNumber: string; readiness: string; buildingId: string; propertyName: string; cleanState: string | null;
}
interface Departure {
  reservationId: string; state: string; channel: string; guestName: string; checkOutTime: string;
  unitId: string; unitNumber: string; buildingId: string; propertyName: string; taskId: string | null; taskState: string | null; guestOut: boolean;
}
interface Day {
  date: string; today: string; arrivals: Arrival[]; departures: Departure[];
  cleans: { total: number; done: number; cleaning: number; ready: number; unassigned: number };
  repairs: RepairOnDay[];
  urgent: { id: string; title: string; state: string; category: string; assigneeName: string | null; blocksUnit: boolean; unitNumber: string; propertyName: string }[];
}

const CHANNELS = ['airbnb', 'booking_com', 'agoda', 'direct', 'owner_stay', 'maintenance_block'];
const unitReady: Record<string, { label: string; tone: ChipTone }> = {
  ready: { label: 'Unit ready', tone: 'success' }, dirty: { label: 'Needs cleaning', tone: 'warning' }, cleaning: { label: 'Cleaning now', tone: 'info' },
  occupied: { label: 'Occupied', tone: 'neutral' }, maintenance: { label: 'Under repair', tone: 'critical' }, blocked: { label: 'Blocked', tone: 'critical' },
};

/** Today: the same day the Cleaning board shows, from the front desk's side. Who arrives and leaves, which cleans
 *  are done, and which repairs have a window today. */
export default function OperationsTodayPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pick, setPick] = useState<'today' | 'tomorrow'>('today');
  const date = pick === 'today' ? mytDay(0) : mytDay(1);
  const { data, loading, error, reload } = useApi<Day>(`/operations/day?date=${date}`);
  const [busy, setBusy] = useState<string | null>(null);

  async function guestLeft(d: Departure) {
    setBusy(d.reservationId);
    try {
      await api.post('/housekeeping/guest-left', d.taskId ? { taskId: d.taskId } : { reservationId: d.reservationId });
      toast({ tone: 'success', title: `${d.unitNumber}: guest out.`, body: 'Cleaning shows it ready to clean.' });
      reload();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: e instanceof ApiFailure ? e.message : 'Try again.' }); }
    finally { setBusy(null); }
  }

  const c = data?.cleans;
  const out = data?.departures.filter(d => d.guestOut).length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Today" sub={data ? `${dayLabel(date)} · ${data.arrivals.length} arriving · ${data.departures.length} leaving · ${c!.done} of ${c!.total} cleans done` : dayLabel(date)}
        actions={<Segmented label="Day" value={pick} onChange={setPick} options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }]} />}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Sparkles" size="sm" />} onClick={() => navigate('/operations/cleaning')}>Open Cleaning</Button>} />
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Arriving" value={data?.arrivals.length} hint={data ? `${data.arrivals.filter(a => a.readiness === 'ready').length} units ready` : undefined} />
        <Stat label="Leaving" value={data?.departures.length} hint={data ? `${out} out so far` : undefined} />
        <Stat label="Cleans done" value={c ? `${c.done} / ${c.total}` : undefined} hint={c ? `${c.ready} ready to clean · ${c.cleaning} in progress${c.unassigned ? ` · ${c.unassigned} unassigned` : ''}` : undefined} warn={!!c?.unassigned} onClick={() => navigate('/operations/cleaning')} />
        <Stat label="Repairs today" value={data?.repairs.length} hint={data ? `${data.urgent.length} urgent open` : undefined} warn={!!data?.urgent.length} onClick={() => navigate('/operations/maintenance')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Panel title="Leaving" count={data?.departures.length} loading={loading && !data} empty="Nobody checks out on this day.">
          {data?.departures.map(d => (
            <Line key={d.reservationId} channel={d.channel} time={d.checkOutTime} unit={`${d.propertyName} ${d.unitNumber}`} guest={d.guestName}
              right={d.guestOut ? <Chip tone="gold">Guest out{d.taskState === 'resolved' ? ', cleaned' : ''}</Chip>
                : d.channel === 'owner_stay' ? <Chip tone="neutral">Owner stay</Chip>
                : <Button size="sm" variant="secondary" loading={busy === d.reservationId} onClick={() => void guestLeft(d)}>Guest out</Button>}
              sub={d.taskId ? undefined : 'No clean planned yet'} subTone="critical" />
          ))}
        </Panel>
        <Panel title="Arriving" count={data?.arrivals.length} loading={loading && !data} empty="Nobody checks in on this day.">
          {data?.arrivals.map(a => {
            const r = unitReady[a.readiness] ?? { label: a.readiness, tone: 'neutral' as ChipTone };
            return (
              <Line key={a.reservationId} channel={a.channel} time={a.checkInTime} unit={`${a.propertyName} ${a.unitNumber}`} guest={`${a.guestName}${a.guests ? ` · ${a.guests} ${a.guests === 1 ? 'guest' : 'guests'}` : ''}`}
                right={a.state === 'checked_in' ? <Chip tone="success">Checked in</Chip> : <Chip tone={r.tone}>{r.label}</Chip>}
                sub={a.cleanState && a.cleanState !== 'resolved' ? `Clean ${a.cleanState === 'in_progress' ? 'in progress' : 'not finished'}` : undefined} subTone="warning" />
            );
          })}
        </Panel>
        <Panel title="Repairs with a window" count={data?.repairs.length} loading={loading && !data} empty="No repair is booked into a unit on this day.">
          {data?.repairs.map(w => (
            <div key={w.id} className="px-4 py-3 [border-top:1px_solid_var(--color-line-soft)] first:border-t-0 flex items-center gap-3 text-copy">
              <span className="w-[86px] flex-none font-semibold [font-variant-numeric:tabular-nums]">{hm(w.startsAt)}–{hm(w.endsAt)}</span>
              <span className="flex-1 min-w-0"><b>{w.propertyName} {w.unitNumber}</b> · {w.title}<span className="block text-meta text-muted-ink">{CATEGORY[w.category] ?? w.category}{w.assigneeName ? ` · ${w.assigneeName}` : ' · nobody assigned'}{w.note ? ` · ${w.note}` : ''}</span></span>
              {w.overlaps.length > 0 ? <Chip tone="critical">Guest in unit</Chip> : w.urgency === 'urgent' ? <Chip tone="critical">Urgent</Chip> : null}
            </div>
          ))}
        </Panel>
        <Panel title="Urgent repairs open" count={data?.urgent.length} loading={loading && !data} empty="No urgent repair is open.">
          {data?.urgent.map(m => (
            <button key={m.id} type="button" onClick={() => navigate(`/operations/maintenance?id=${m.id}`)}
              className="w-full text-left px-4 py-3 [border-top:1px_solid_var(--color-line-soft)] first:border-t-0 flex items-center gap-3 text-copy cursor-pointer hover:bg-page">
              <span className="flex-1 min-w-0"><b>{m.propertyName} {m.unitNumber}</b> · {m.title}<span className="block text-meta text-muted-ink">{CATEGORY[m.category] ?? m.category} · {m.assigneeName ?? 'nobody assigned'}</span></span>
              {m.blocksUnit && <Chip tone="critical">Unit blocked</Chip>}
              <Icon name="ChevronRight" size="sm" color="var(--color-faint)" />
            </button>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, warn, onClick }: { label: string; value: number | string | undefined; hint?: string; warn?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={cx('text-left bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-1 min-w-0', onClick && 'cursor-pointer hover:bg-page')}>
      <span className="text-meta text-muted-ink">{label}</span>
      {value === undefined ? <Skeleton width={60} height={26} /> : <span className="text-headline font-semibold [font-variant-numeric:tabular-nums]">{value}</span>}
      {hint && <span className={cx('text-meta', warn ? 'text-[var(--color-critical-fg)]' : 'text-muted-ink')}>{hint}</span>}
    </Tag>
  );
}

function Panel({ title, count, loading, empty, children }: { title: string; count?: number; loading: boolean; empty: string; children: ReactNode }) {
  return (
    <section className="bg-card rounded-card border border-solid border-line overflow-hidden">
      <header className="px-4 py-3 bg-[#F4F1EB] flex items-center gap-2"><b className="text-heading">{title}</b>{count !== undefined && <span className="text-muted-ink">{count}</span>}</header>
      {loading ? <div className="p-4 flex flex-col gap-2"><Skeleton height={36} /><Skeleton height={36} /></div>
        : count === 0 ? <p className="m-0 px-4 py-5 text-copy text-muted-ink">{empty}</p>
        : <div className="max-h-[420px] overflow-y-auto ops-scroll">{children}</div>}
    </section>
  );
}

function Line({ channel, time, unit, guest, right, sub, subTone }: { channel: string; time: string; unit: string; guest: string; right: ReactNode; sub?: string; subTone?: 'critical' | 'warning' }) {
  return (
    <div className="px-4 py-3 [border-top:1px_solid_var(--color-line-soft)] first:border-t-0 flex items-center gap-3 text-copy">
      <span className="w-[46px] flex-none font-semibold [font-variant-numeric:tabular-nums]">{time}</span>
      {CHANNELS.includes(channel) && <ChannelMark ch={channel as BookingChannel} size={20} />}
      <span className="flex-1 min-w-0">
        <b className="block truncate">{unit}</b>
        <span className="block truncate text-muted-ink">{guest}</span>
        {sub && <span className={cx('block text-meta', subTone === 'critical' ? 'text-[var(--color-critical-fg)]' : 'text-[var(--color-warning-fg)]')}>{sub}</span>}
      </span>
      <span className="flex-none">{right}</span>
    </div>
  );
}
