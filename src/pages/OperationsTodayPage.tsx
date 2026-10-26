import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner } from '../components/DataState';
import { Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { TimeField } from '../components/inputs';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import type { BookingChannel } from '../lib/types';
import { Segmented, OpsModal, dayLabel, hm, mytDay, CATEGORY } from '../components/ops/OpsUi';
import type { AnyTone } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';
import { StatRow, StatTile, SectionTitle } from '../components/Metric';

interface Arrival {
  reservationId: string; state: string; channel: string; guestName: string; guests: number; checkInTime: string; checkOut: string;
  unitId: string; unitNumber: string; readiness: string; buildingId: string; propertyName: string; cleanState: string | null; arrivedAt: string | null;
}
interface Departure {
  reservationId: string; state: string; channel: string; guestName: string; checkOutTime: string;
  unitId: string; unitNumber: string; buildingId: string; propertyName: string; taskId: string | null; taskState: string | null; guestOut: boolean; leftAt: string | null;
}
type Progress = 'reported' | 'assigned' | 'in_progress' | 'repair_finished' | 'awaiting_owner' | 'done';
interface Job {
  id: string; title: string; state: string; progress: Progress; why: 'overdue' | 'urgent' | 'visit' | 'blocking'; urgent: boolean;
  category: string; assigneeName: string | null; blocksUnit: boolean; visit: { startsAt: string; endsAt: string } | null; dueBy: string | null;
  unitNumber: string; propertyName: string;
}
type Free = 'ready' | 'needs_cleaning' | 'cleaning' | 'blocked';
interface FreeUnit {
  unitId: string; unitNumber: string; buildingId: string; propertyName: string; bedrooms: number; maxGuests: number;
  status: Free; note: string | null; nextCheckIn: string | null;
}
interface Day {
  date: string; today: string; arrivals: Arrival[]; departures: Departure[];
  cleans: { total: number; done: number; cleaning: number; ready: number; unassigned: number };
  maintenance: Job[]; available: FreeUnit[];
}

const CHANNELS = ['airbnb', 'booking_com', 'agoda', 'direct', 'owner_stay', 'maintenance_block'];
const unitReady: Record<string, { label: string; tone: AnyTone }> = {
  ready: { label: 'Unit ready', tone: 'success' }, dirty: { label: 'Needs cleaning', tone: 'warning' }, cleaning: { label: 'Cleaning now', tone: 'warning' },
  occupied: { label: 'Occupied', tone: 'info' }, maintenance: { label: 'Under repair', tone: 'warning' }, blocked: { label: 'Blocked', tone: 'critical' },
};
const PROGRESS: Record<Progress, { label: string; tone: AnyTone }> = {
  reported: { label: 'Reported', tone: 'neutral' }, assigned: { label: 'Assigned', tone: 'neutral' }, in_progress: { label: 'In progress', tone: 'info' },
  repair_finished: { label: 'Repair finished', tone: 'info' }, awaiting_owner: { label: 'Awaiting owner approval', tone: 'warning' }, done: { label: 'Done', tone: 'success' },
};
const FREE: Record<Free, { label: string; tone: AnyTone }> = {
  ready: { label: 'Ready', tone: 'success' }, needs_cleaning: { label: 'Needs cleaning', tone: 'warning' },
  cleaning: { label: 'Cleaning now', tone: 'info' }, blocked: { label: 'Blocked for repair', tone: 'critical' },
};
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const units = (n: number) => count(n, 'unit');
// back=today puts a "Back to Today" link on Reservations, which has no other way back but the browser's.
const reservationLink = (id: string) => `/reservations/bookings?open=${encodeURIComponent(id)}&back=today`;

/** Today: the same day the Cleaning board shows, from the front desk's side. Who arrives and leaves (each opens its
 *  reservation), the maintenance to watch, and which units have nobody staying that night. */
export default function OperationsTodayPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pick, setPick] = useState<'today' | 'tomorrow'>('today');
  const date = pick === 'today' ? mytDay(0) : mytDay(1);
  const { data, loading, error, reload: reloadData } = useApi<Day>(`/operations/day?date=${date}`);
  // The side menu's counts (open jobs, today's work) follow what was just done here.
  const reload = () => { reloadData(); void refreshNavCounts(); };
  const [busy, setBusy] = useState<string | null>(null);
  const [editTime, setEditTime] = useState<{ id: string; which: 'in' | 'out'; label: string; value: string } | null>(null);

  async function guestLeft(d: Departure) {
    setBusy(d.reservationId);
    try {
      await api.post('/housekeeping/guest-left', d.taskId ? { taskId: d.taskId } : { reservationId: d.reservationId });
      toast({ tone: 'success', title: `${d.unitNumber}: guest out.`, body: 'Cleaning shows it ready to clean.' });
      reload();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again.') }); }
    finally { setBusy(null); }
  }
  // The booking's own Check in move (the drawer's status menu): the unit is marked occupied and the time is kept.
  async function guestArrived(a: Arrival) {
    setBusy(a.reservationId);
    try {
      await api.patch(`/reservations/${a.reservationId}`, { state: 'checked_in' });
      toast({ tone: 'success', title: `${a.unitNumber}: guest checked in.`, body: 'The reservation shows Currently hosting.' });
      reload();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again.') }); }
    finally { setBusy(null); }
  }

  const c = data?.cleans;
  const out = data?.departures.filter(d => d.guestOut).length ?? 0;
  const arrived = data?.arrivals.filter(a => a.state === 'checked_in' || a.state === 'checked_out').length ?? 0;
  const isToday = !!data && data.date === data.today;
  const openJobs = data?.maintenance.filter(m => m.progress !== 'done') ?? [];
  const late = openJobs.filter(m => m.why === 'overdue').length;
  const urgent = openJobs.filter(m => m.urgent).length;
  const readyFree = data?.available.filter(u => u.status === 'ready').length ?? 0;
  const night = pick === 'today' ? 'tonight' : 'tomorrow night';
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Today"
        // vocab-ok: data.arrivals and data.departures are API field names, not words on screen
        sub={data ? `${dayLabel(date)} · ${count(data.arrivals.length, 'check-in')} · ${count(data.departures.length, 'checkout')} · ${c!.done} of ${count(c!.total, 'cleaning job')} done` : dayLabel(date)}
        actions={<Segmented label="Day" value={pick} onChange={setPick} options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }]} />}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Sparkles" size="sm" />} onClick={() => navigate('/operations/cleaning')}>Open Cleaning</Button>} />
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <StatRow cols={5}>
        <StatTile label="Check-ins" value={data ? String(data.arrivals.length) : undefined}
          // vocab-ok: data.arrivals is an API field name, not a word on screen
          hint={data ? (isToday ? `${arrived} arrived · ${units(data.arrivals.filter(a => a.state === 'confirmed' && a.readiness === 'ready' && (!a.cleanState || a.cleanState === 'resolved')).length)} ready` : `${units(data.arrivals.filter(a => a.readiness === 'ready').length)} ready now`) : undefined} />
        <StatTile label="Checkouts" value={data ? String(data.departures.length) : undefined} hint={isToday ? `${out} out so far` : undefined} />
        <StatTile label="Cleaning jobs done" value={c ? `${c.done} / ${c.total}` : undefined} hint={c ? `${c.ready} ready to clean · ${c.cleaning} in progress${c.unassigned ? ` · ${c.unassigned} unassigned` : ''}` : undefined} hintTone={c?.unassigned ? 'critical' : undefined} onClick={() => navigate('/operations/cleaning')} />
        <StatTile label={pick === 'today' ? 'Maintenance today' : 'Maintenance tomorrow'} value={data ? String(openJobs.length) : undefined}
          hint={data ? `${urgent} urgent · ${late} overdue` : undefined} hintTone={urgent || late ? 'critical' : undefined} onClick={() => navigate('/operations/maintenance')} />
        <StatTile label={pick === 'today' ? 'Free tonight' : 'Free tomorrow night'} value={data ? String(data.available.length) : undefined}
          hint={data ? `${readyFree} ready` : undefined} />
      </StatRow>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Panel title="Checkouts" count={data?.departures.length} loading={loading && !data} empty="Nobody checks out on this day.">
          {data?.departures.map(d => {
            const canEdit = !d.guestOut && d.state !== 'checked_out';
            return (
              <StayLine key={d.reservationId} id={d.reservationId} channel={d.channel} time={d.checkOutTime}
                done={d.leftAt ? `Left ${hm(d.leftAt)}` : d.guestOut ? 'Out' : undefined}
                unit={`${d.propertyName} ${d.unitNumber}`} guest={d.guestName}
                sub={d.taskId ? undefined : 'No cleaning job planned yet'} subTone="critical"
                actions={<>
                  {d.guestOut ? <StatusBadge tone="gold">Guest out{d.taskState === 'resolved' ? ', cleaned' : ''}</StatusBadge>
                    : d.channel === 'owner_stay' ? <StatusBadge tone="neutral">Owner stay</StatusBadge>
                    : !isToday ? <StatusBadge tone="neutral">Leaves {d.checkOutTime}</StatusBadge>
                    : <Button size="sm" variant="secondary" loading={busy === d.reservationId} onClick={() => void guestLeft(d)}>Guest left</Button>}
                  {canEdit && <TimeButton label="Change checkout time" onClick={() => setEditTime({ id: d.reservationId, which: 'out', label: `${d.propertyName} ${d.unitNumber}`, value: d.checkOutTime })} />}
                </>} />
            );
          })}
        </Panel>
        <Panel title="Check-ins" count={data?.arrivals.length} loading={loading && !data} empty="Nobody checks in on this day.">
          {data?.arrivals.map(a => {
            const r = unitReady[a.readiness] ?? { label: a.readiness, tone: 'neutral' as AnyTone };
            const inside = a.state === 'checked_in' || a.state === 'checked_out';
            const canArrive = isToday && a.state === 'confirmed' && a.channel !== 'owner_stay';
            return (
              <StayLine key={a.reservationId} id={a.reservationId} channel={a.channel} time={a.checkInTime}
                done={a.arrivedAt ? `Arrived ${hm(a.arrivedAt)}` : inside ? 'Arrived' : undefined}
                unit={`${a.propertyName} ${a.unitNumber}`} guest={`${a.guestName}${a.guests ? ` · ${a.guests} ${a.guests === 1 ? 'guest' : 'guests'}` : ''}`}
                sub={!inside && a.cleanState && a.cleanState !== 'resolved' ? `Cleaning ${a.cleanState === 'in_progress' ? 'in progress' : 'not finished'}` : undefined} subTone="warning"
                actions={<>
                  {inside ? <StatusBadge tone="success">Currently hosting</StatusBadge> : <StatusBadge tone={r.tone}>{r.label}</StatusBadge>}
                  {canArrive && <Button size="sm" variant="secondary" loading={busy === a.reservationId} onClick={() => void guestArrived(a)}>Guest arrived</Button>}
                  {!inside && <TimeButton label="Change check-in time" onClick={() => setEditTime({ id: a.reservationId, which: 'in', label: `${a.propertyName} ${a.unitNumber}`, value: a.checkInTime })} />}
                </>} />
            );
          })}
        </Panel>
        <div className="xl:col-span-2">
          <Panel title="Maintenance" count={data?.maintenance.length} loading={loading && !data}
            empty={pick === 'today' ? 'No repair visit today, and no urgent or overdue job is open.' : 'No repair visit tomorrow, and no urgent or overdue job is open.'}>
            {data?.maintenance.map(m => <JobLine key={m.id} m={m} />)}
          </Panel>
        </div>
        <div className="xl:col-span-2">
          <FreeUnits units={data?.available} loading={loading && !data} night={night} />
        </div>
      </div>

      {editTime && <TimeDialog edit={editTime} onClose={() => setEditTime(null)} onSaved={() => { setEditTime(null); reload(); }} />}
    </div>
  );
}

function Panel({ title, count, loading, empty, right, children }: { title: string; count?: number; loading: boolean; empty: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-card rounded-card border border-solid border-line overflow-hidden">
      <SectionTitle title={title} count={count} right={right} />
      <div className="[border-top:1px_solid_var(--color-line-soft)]">
        {loading ? <div className="p-5 flex flex-col gap-2"><Skeleton height={36} /><Skeleton height={36} /></div>
          : count === 0 ? <p className="m-0 px-5 py-5 text-copy text-muted-ink">{empty}</p>
          : children}
      </div>
    </section>
  );
}

const ROW = 'px-4 sm:px-5 py-3 [border-top:1px_solid_var(--color-line-soft)] first:border-t-0';

/** One check-in or checkout. The left part opens the reservation; the actions sit beside it, under it on a phone. */
function StayLine({ id, channel, time, done, unit, guest, sub, subTone, actions }: {
  id: string; channel: string; time: string; done?: string; unit: string; guest: string; sub?: string; subTone?: 'critical' | 'warning'; actions: ReactNode;
}) {
  return (
    <div className={cx(ROW, 'flex flex-wrap items-center gap-x-3 gap-y-2 text-copy')}>
      <Link to={reservationLink(id)} aria-label={`Open reservation: ${unit}, ${guest}`}
        className="flex-1 min-w-[min(100%,24rem)] flex items-center gap-3 text-ink no-underline rounded-control -m-1 p-1 hover:bg-page">
        <span className="min-w-[52px] sm:w-[88px] flex-none flex flex-col whitespace-nowrap">
          <span className="font-semibold [font-variant-numeric:tabular-nums]">{time}</span>
          {done && <span className="text-meta text-success [font-variant-numeric:tabular-nums]">{done}</span>}
        </span>
        {CHANNELS.includes(channel) && <ChannelMark ch={channel as BookingChannel} size={20} />}
        <span className="flex-1 min-w-0">
          {/* The unit wraps rather than cuts: on a phone the cut-off part is the unit number. */}
          <b className="block [overflow-wrap:anywhere]">{unit}</b>
          <span className="block text-muted-ink [overflow-wrap:anywhere]">{guest}</span>
          {sub && <span className={cx('block text-meta', subTone === 'critical' ? 'text-danger' : 'text-warning')}>{sub}</span>}
        </span>
        <Icon name="ChevronRight" size="sm" color="var(--color-faint)" />
      </Link>
      <span className="flex items-center gap-2 flex-wrap justify-end ml-auto">{actions}</span>
    </div>
  );
}

function TimeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button size="sm" variant="tertiary" icon={<Icon name="Clock" size="sm" />} aria-label={label} title={label} onClick={onClick}>Time</Button>;
}

/** The booking's expected check-in or checkout time, through the same endpoint as the booking drawer's times dialog. */
function TimeDialog({ edit, onClose, onSaved }: { edit: { id: string; which: 'in' | 'out'; label: string; value: string }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(edit.value);
  const [busy, setBusy] = useState(false);
  const what = edit.which === 'in' ? 'Check-in' : 'Checkout';
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/reservations/${edit.id}/details`, edit.which === 'in' ? { checkInTime: value } : { checkOutTime: value });
      toast({ tone: 'success', title: `${edit.label}: ${what.toLowerCase()} ${edit.which === 'in' ? 'from' : 'by'} ${value}.`, body: 'Cleaning plans with the new time.' });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Time not changed.', body: errorMessage(e, 'Try again.') }); setBusy(false); }
  }
  return (
    <OpsModal title={`${what} time`} sub={`${edit.label}. For an early check-in or a late checkout; the dates do not change and the guest is not messaged.`}
      onClose={onClose} busy={busy} width={400}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!value || value === edit.value} disabledReason="Change the time first." onClick={() => void save()}>Save time</Button>
      </>}>
      <TimeField label={edit.which === 'in' ? 'Check-in from' : 'Checkout by'} value={value} onChange={setValue} help={edit.which === 'in' ? 'Standard 15:00' : 'Standard 11:00'} />
    </OpsModal>
  );
}

/** One maintenance job: when and why it is on today's list, how far it has got, who has it. Opens the job. */
function JobLine({ m }: { m: Job }) {
  const p = PROGRESS[m.progress] ?? { label: m.progress, tone: 'neutral' as AnyTone };
  const when = m.visit ? `${hm(m.visit.startsAt)}–${hm(m.visit.endsAt)}` : 'No visit booked';
  return (
    <Link to={`/operations/maintenance?id=${encodeURIComponent(m.id)}`}
      className={cx(ROW, 'flex flex-wrap items-center gap-x-3 gap-y-2 text-copy text-ink no-underline hover:bg-page')}>
      <span className={cx('w-[96px] flex-none [font-variant-numeric:tabular-nums]', m.visit ? 'font-semibold' : 'text-meta text-muted-ink')}>{when}</span>
      <span className="flex-1 min-w-[180px]">
        <b className="[overflow-wrap:anywhere]">{m.propertyName} {m.unitNumber}</b> · {m.title}
        <span className="block text-meta text-muted-ink">{CATEGORY[m.category] ?? m.category} · {m.assigneeName ?? 'nobody assigned'}{m.dueBy ? ` · available again ${dayLabel(m.dueBy)}` : ''}</span>
      </span>
      <span className="flex items-center gap-2 flex-wrap justify-end ml-auto">
        {m.progress !== 'done' && m.why === 'overdue' && <StatusBadge tone="critical">Overdue</StatusBadge>}
        {m.progress !== 'done' && m.urgent && m.why !== 'overdue' && <StatusBadge tone="critical">Urgent</StatusBadge>}
        {m.progress !== 'done' && m.blocksUnit && <StatusBadge tone="warning">Unit blocked</StatusBadge>}
        <StatusBadge tone={p.tone}>{p.label}</StatusBadge>
        <Icon name="ChevronRight" size="sm" color="var(--color-faint)" />
      </span>
    </Link>
  );
}

/** Units with nobody staying that night, by building, with whether each can take a guest. */
function FreeUnits({ units, loading, night }: { units: FreeUnit[] | undefined; loading: boolean; night: string }) {
  const [show, setShow] = useState<'all' | Free>('all');
  const n = (s: Free) => units?.filter(u => u.status === s || (s === 'needs_cleaning' && u.status === 'cleaning')).length ?? 0;
  const shown = (units ?? []).filter(u => show === 'all' || u.status === show || (show === 'needs_cleaning' && u.status === 'cleaning'));
  const buildings = (() => {
    const m = new Map<string, { name: string; units: FreeUnit[] }>();
    for (const u of shown) (m.get(u.buildingId) ?? m.set(u.buildingId, { name: u.propertyName, units: [] }).get(u.buildingId)!).units.push(u);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();
  return (
    <Panel title={`Available units ${night}`} count={units?.length} loading={loading} empty={`Every unit has a guest ${night}.`}>
      <div className="px-4 sm:px-5 pt-3">
        {/* Wraps instead of scrolling sideways, so no choice is hidden off the edge of a phone. */}
        <div role="tablist" aria-label="Show" className="flex flex-wrap gap-2">
          {([['all', 'All', units?.length], ['ready', 'Ready', n('ready')], ['needs_cleaning', 'Needs cleaning', n('needs_cleaning')], ['blocked', 'Blocked for repair', n('blocked')]] as const).map(([v, label, k]) => (
            <button key={v} type="button" role="tab" aria-selected={show === v} onClick={() => setShow(v)}
              className={cx('h-9 px-3.5 rounded-pill text-copy font-medium cursor-pointer whitespace-nowrap border border-solid',
                show === v ? 'bg-black text-white border-black' : 'bg-card text-ink border-line hover:bg-muted')}>
              {label}<span className={cx('ml-1.5 [font-variant-numeric:tabular-nums]', show === v ? 'text-gold' : 'text-muted-ink')}>{k}</span>
            </button>
          ))}
        </div>
      </div>
      {buildings.length === 0 && <p className="m-0 px-5 py-5 text-copy text-muted-ink">No unit in this group.</p>}
      {buildings.map(b => (
        <div key={b.name} className="px-4 sm:px-5 py-3">
          <div className="text-meta font-semibold text-muted-ink mb-2">{b.name} <span className="font-normal">· {b.units.length}</span></div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
            {b.units.map(u => {
              const s = FREE[u.status];
              return (
                <div key={u.unitId} className="rounded-control border border-solid border-line px-3 py-2 flex flex-col gap-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-copy [overflow-wrap:anywhere]">{u.unitNumber}</b>
                    <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  </div>
                  <span className="text-meta text-muted-ink">
                    {u.bedrooms ? `${count(u.bedrooms, 'bedroom')} · ` : ''}up to {count(u.maxGuests, 'guest')}
                    {u.nextCheckIn ? ` · next check-in ${dayLabel(u.nextCheckIn)}` : ' · no check-in booked'}
                  </span>
                  {u.note && <span className={cx('text-meta [overflow-wrap:anywhere]', u.status === 'blocked' ? 'text-danger' : 'text-warning')}>{u.note}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Panel>
  );
}
