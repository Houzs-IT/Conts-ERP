import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import { ConfirmButton } from '../../components/ConfirmDialog';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { DateField, TimeField } from '../../components/inputs';
import { StatTile, StatRow } from '../../components/Metric';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { date, time, rm } from '../../lib/format';
import type { Nearest } from '../../../functions/_lib/attendanceCalc';
import { mapLink } from '../../../functions/_lib/punchSites';
import type { AttendanceLine } from '../../../functions/api/attendance/index';
import type { HoursPayload } from '../../../functions/api/working-hours/index';
import type { Employee } from '../../../functions/_lib/hrFields';

/* ------------------------------------------------------------------ *
 * HR > Employees > Attendance: Hookka's Attendance tab. The month's
 * figures on top, then everyone on the day: when they punched, whether at
 * a building or punch site (with a map link), and the selfies, or that
 * they are not in or on leave. The office fixes a forgotten clock-out or
 * keys a day nobody punched here; the portal's Clock screen is where
 * people punch.
 * ------------------------------------------------------------------ */

interface DayPayload { date: string; today: string; sitesToCompare: number; data: AttendanceLine[] }

const hm = (min: number): string => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
/** "08:30" in Malaysia time, for the fix form. */
const hhmm = (iso: string): string => time(iso).slice(0, 5);
const place = (p: Nearest | null): string =>
  !p ? '' : p.onSite ? `At ${p.name}` : `${p.metres >= 1000 ? `${(p.metres / 1000).toFixed(1)} km` : `${p.metres} m`} from ${p.name}`;
const mytDay = (iso: string): string => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);
const rowKey = (l: AttendanceLine): string => l.employee.id ?? l.employee.cleanerId ?? l.employee.technicianId ?? l.employee.name;

/** Hookka's location badge: at a building or punch site (within its radius), off-site, or no location. The clock-in
 *  decides; the clock-out stands in when the clock-in had no GPS. Soft only: it never blocks a punch. */
function siteOf(l: AttendanceLine): { label: string; tone: 'success' | 'warning' | 'neutral'; off: boolean } {
  const p = l.punch;
  if (!p) return { label: '', tone: 'neutral', off: false };
  if (!p.inGps && !p.outGps) return { label: p.edited && !p.inPhoto ? 'Keyed by the office' : 'No GPS', tone: 'neutral', off: false };
  const near = (p.inGps ? l.inPlace : null) ?? l.outPlace;
  if (!near) return { label: 'No site to compare', tone: 'neutral', off: false };
  return near.onSite ? { label: `At ${near.name}`, tone: 'success', off: false } : { label: `Off-site · ${place(near)}`, tone: 'warning', off: true };
}

/** Where each punch was, as map links: In and Out, or one when only one had GPS. */
function MapLinks({ line }: { line: AttendanceLine }) {
  const p = line.punch;
  if (!p || (!p.inAt && !p.outAt)) return null;
  const link = (at: { lat: number; lng: number }, label: string) => (
    <a key={label} href={mapLink(at.lat, at.lng)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className="text-meta text-muted-ink underline underline-offset-2">{label}</a>
  );
  return <span className="flex gap-2">{p.inAt && link(p.inAt, 'Map in')}{p.outAt && link(p.outAt, 'Map out')}</span>;
}

/** Someone with no punch on the day: on approved leave, or not in. */
const absence = (l: AttendanceLine) => (l.leave ? <StatusBadge tone="neutral" label="On leave" size="sm" /> : <StatusBadge tone="warning" label="Not in" size="sm" />);

const monthEnd = (m: string): string => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** Hookka's month dashboard over the calendar month of the day shown: active workers, average salary, and the hours one
 *  person logs in one day (logged hours, the punch where nothing is logged, over the person-days). Efficiency and
 *  production hours wait for production time to be decided. */
function MonthFigures({ day, today }: { day: string; today: string }) {
  const month = day.slice(0, 7);
  const to = monthEnd(month) < today ? monthEnd(month) : today;
  const hours = useApi<HoursPayload>(`/working-hours?from=${month}-01&to=${to < `${month}-01` ? `${month}-01` : to}`);
  const people = useApi<{ data: Employee[] }>('/employees');
  const active = (people.data?.data ?? []).filter(e => e.isActive && e.status === 'active');
  const avgSalary = active.length ? Math.round(active.reduce((n, e) => n + e.basicSalarySen, 0) / active.length) : 0;
  const perDay = new Map<string, number>();
  for (const e of hours.data?.entries ?? []) perDay.set(`${e.employeeId}|${e.date}`, (perDay.get(`${e.employeeId}|${e.date}`) ?? 0) + e.hours);
  const logged = new Set(perDay.keys());
  for (const p of hours.data?.punches ?? []) if (!logged.has(`${p.employeeId}|${p.date}`)) perDay.set(`${p.employeeId}|${p.date}`, (perDay.get(`${p.employeeId}|${p.date}`) ?? 0) + p.hours);
  const days = [...perDay.values()].filter(h => h > 0);
  const avgHours = days.length ? days.reduce((n, h) => n + h, 0) / days.length : 0;
  const busy = (hours.loading && !hours.data) || (people.loading && !people.data);
  return (
    <StatRow cols={5}>
      <StatTile label="Active Workers" value={people.data ? String(active.length) : undefined} loading={busy} />
      <StatTile label="Avg Efficiency (this month)" value="—" hint="Production time not decided" />
      <StatTile label="Avg Salary / Worker" value={people.data ? rm(avgSalary) : undefined} loading={busy} />
      <StatTile label="Avg Working Hrs / day" value={hours.data ? `${avgHours.toFixed(1)}h` : undefined} hint={hours.error ?? `${days.length} person-days`} hintTone={hours.error ? 'critical' : undefined} loading={busy} />
      <StatTile label="Avg Production Hrs / day" value="—" hint="Production time not decided" />
    </StatRow>
  );
}

export default function AttendanceTab() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('day');
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const { data, loading, error, reload } = useApi<DayPayload>(`/attendance${day ? `?date=${day}` : ''}`);
  const { user } = useSession();
  const mayFix = mayWork(user, 'hr');
  const [fixing, setFixing] = useState<AttendanceLine | null>(null);
  const [photo, setPhoto] = useState<{ src: string; title: string } | null>(null);

  const shown = data?.date ?? day ?? '';
  const setDay = (d: string) => setParams(p => { const n = new URLSearchParams(p); n.set('day', d); return n; }, { replace: true });
  const lines = data?.data ?? [];
  // Everyone active is listed, punched or not, so a missing punch shows; who is not in or on leave is also counted.
  const punched = lines.filter(l => l.punch);
  const offSite = punched.filter(l => siteOf(l).off).length;
  const onLeave = lines.filter(l => !l.punch && l.leave).length;
  const noOut = punched.filter(l => l.punch?.forgotOut).length;

  const columns = useMemo<Column<AttendanceLine>[]>(() => [
    { key: 'name', label: 'Employee', value: l => l.employee.name, hideable: false, width: 190,
      render: l => <span className="flex flex-col"><span className="font-semibold">{l.employee.name}</span>{l.employee.employeeId && <span className="text-meta text-muted-ink">{l.employee.employeeId}</span>}</span> },
    { key: 'in', label: 'Clock In', value: l => l.punch?.clockInAt ?? null, width: 100, render: l => l.punch ? <span className="tabular-nums">{time(l.punch.clockInAt)}</span> : absence(l) },
    { key: 'out', label: 'Clock Out', value: l => l.punch?.clockOutAt ?? null, width: 110,
      render: l => !l.punch ? '' : l.punch.clockOutAt ? <span className="tabular-nums">{time(l.punch.clockOutAt)}</span> : l.punch.forgotOut ? <StatusBadge tone="warning" label="No clock-out" size="sm" /> : <span className="text-muted-ink">In now</span> },
    { key: 'hours', label: 'Hours', type: 'number', value: l => l.punch?.minutes ?? null, width: 90, render: l => l.punch && !l.punch.forgotOut ? <span className="tabular-nums">{hm(l.punch.minutes)}</span> : '' },
    { key: 'where', label: 'Location', value: l => siteOf(l).label || null, width: 260,
      render: l => l.punch ? <span className="flex flex-col items-start gap-1"><StatusBadge tone={siteOf(l).tone} label={siteOf(l).label} size="sm" /><MapLinks line={l} /></span> : '' },
    { key: 'photos', label: 'Photo', noExport: true, sortable: false, filter: false, width: 130, render: l => <Selfies line={l} onOpen={setPhoto} /> },
    { key: 'note', label: 'Office fix', value: l => l.punch?.note ?? null, width: 180, hidden: true },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 100, align: 'right',
      render: l => !mayFix ? null : l.punch
        ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setFixing(l)}>Fix</Button>
        : <Button size="sm" variant="tertiary" icon={<Icon name="Plus" size="sm" />} onClick={() => setFixing(l)}>Key day</Button> },
  ], [mayFix]);

  return (
    <div className="flex flex-col gap-5">
      {data && <MonthFigures day={shown} today={data.today} />}
      {error && <StaleBanner message={`Showing the last day we have. ${error}`} onRetry={reload} />}

      <DataTable<AttendanceLine>
        id="attendance" columns={columns} rows={loading && lines.length === 0 ? null : lines} rowKey={rowKey}
        pageSize={0} noun={['person', 'people']} exportName={`attendance-${shown}`}
        header={
          <div className="pt-5 pb-4 px-5 flex flex-col gap-3 [border-bottom:1px_solid_var(--color-line-soft)]">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <span className="flex flex-col gap-0.5">
                <span className="text-[16px] font-semibold tracking-[-0.01em]">Daily Attendance</span>
                <span className="text-meta text-muted-ink">
                  Everyone active, punched or not. A phone punch shows where they were against the buildings and punch sites; off-site = outside every site's radius.
                  {offSite > 0 && <span className="font-semibold text-warning"> {offSite} off-site.</span>}
                </span>
              </span>
              <span className="flex items-end gap-2 flex-wrap">
                <Button size="sm" variant="secondary" icon={<Icon name="ChevronLeft" size="sm" />} disabled={!shown} onClick={() => setDay(shift(shown, -1))}>Day before</Button>
                <div className="w-[170px] flex-none"><DateField aria-label="Day" value={shown} max={data?.today} onChange={v => v && setDay(v)} /></div>
                <Button size="sm" variant="secondary" disabled={!shown || !data || shown >= data.today} onClick={() => setDay(shift(shown, 1))}>Next day</Button>
                {data && shown !== data.today && <Button size="sm" variant="tertiary" onClick={() => setDay(data.today)}>Today</Button>}
              </span>
            </div>
            {data && (
              <span className="text-meta text-muted-ink">
                {date(`${shown}T12:00:00+08:00`)} · {punched.length} punched · {lines.length - punched.length - onLeave} not in{onLeave ? ` · ${onLeave} on leave` : ''}{noOut ? ` · ${noOut} no clock-out` : ''}
                {data.sitesToCompare === 0 ? ' · No building or punch site has a map location yet, so nobody can read as on site.' : ''}
              </span>
            )}
          </div>
        }
        empty={{ title: 'Nobody to list.', body: 'Attendance lists the in-house cleaners and technicians on Employee Master. People clock in and out on their phone, with a selfie and their location.' }}
        renderCard={l => (
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="flex items-center gap-[9px] flex-wrap">
              <span className="text-copy font-semibold">{l.employee.name}</span>
              {l.punch ? <StatusBadge tone={siteOf(l).tone} label={siteOf(l).label} size="sm" /> : absence(l)}
            </span>
            {l.punch && (
              <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap tabular-nums">
                <span>{time(l.punch.clockInAt)} – {l.punch.clockOutAt ? time(l.punch.clockOutAt) : l.punch.forgotOut ? 'no clock-out' : '…'}</span>
                {!l.punch.forgotOut && <span>{hm(l.punch.minutes)}</span>}
              </span>
            )}
            {l.punch && <MapLinks line={l} />}
            {l.punch && <span className="flex items-center gap-2 pt-1"><Selfies line={l} onOpen={setPhoto} />{mayFix && <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setFixing(l)}>Fix</Button>}</span>}
            {!l.punch && mayFix && <span className="flex pt-1"><Button size="sm" variant="tertiary" icon={<Icon name="Plus" size="sm" />} onClick={() => setFixing(l)}>Key day</Button></span>}
          </span>
        )}
      />

      {fixing && shown && <FixModal line={fixing} day={shown} onClose={() => setFixing(null)} onSaved={() => { setFixing(null); reload(); }} />}
      {photo && (
        <Modal title={photo.title} onClose={() => setPhoto(null)} width={420} footer={<Button size="sm" variant="secondary" onClick={() => setPhoto(null)}>Close</Button>}>
          <img src={photo.src} alt="Punch selfie" className="w-full rounded-control" />
        </Modal>
      )}
    </div>
  );
}

/** Hookka's punch thumbnails: small selfies that load as they scroll into view; a click shows the full one. */
function Selfies({ line, onOpen }: { line: AttendanceLine; onOpen: (p: { src: string; title: string }) => void }) {
  const p = line.punch;
  if (!p) return null;
  const thumb = (side: 'in' | 'out', at: string | null) => {
    const src = `/api/attendance/${p.id}/photo/${side}`;
    const label = side === 'in' ? 'In' : 'Out';
    return (
      <button type="button" title={`View ${label.toLowerCase()} photo`} onClick={e => { e.stopPropagation(); onOpen({ src, title: `${line.employee.name} · Clock ${label} ${at ? time(at) : ''}` }); }}
        className="relative flex-none p-0 border-0 bg-transparent cursor-pointer">
        <img src={src} alt={`${label} punch`} loading="lazy" className="size-10 rounded-[6px] object-cover border border-solid border-line" />
        <span className="absolute -bottom-1 -right-1 rounded-[4px] bg-ink px-1 text-[9px] leading-[12px] text-white">{label}</span>
      </button>
    );
  };
  if (!p.inPhoto && !p.outPhoto) return <span className="text-meta text-muted-ink">No photo</span>;
  return <span className="flex gap-2">{p.inPhoto && thumb('in', p.clockInAt)}{p.outPhoto && thumb('out', p.clockOutAt)}</span>;
}

/** Fix a punch's times, or (no punch on the day) key the day for someone who forgot to clock in. */
function FixModal({ line, day, onClose, onSaved }: { line: AttendanceLine; day: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const p = line.punch;
  const [clockIn, setClockIn] = useState(p ? hhmm(p.clockInAt) : '');
  const [clockOut, setClockOut] = useState(p?.clockOutAt ? hhmm(p.clockOutAt) : '');
  // The clock-out's own Malaysia day is after the work day: a shift past midnight.
  const [outNextDay, setOutNextDay] = useState(!!p?.clockOutAt && mytDay(p.clockOutAt) > p.date);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const shownDay = date(`${p?.date ?? day}T12:00:00+08:00`);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const times = { clockIn, clockOut: clockOut || null, outNextDay, note };
      if (p) await api.patch(`/attendance/${p.id}`, times);
      else await api.post('/attendance', { ...times, date: day, employeeId: line.employee.id, cleanerId: line.employee.cleanerId, technicianId: line.employee.technicianId });
      toast({ tone: 'success', title: p ? 'Times fixed.' : 'Day keyed.', body: `${line.employee.name}, ${shownDay}.` });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  async function remove(reason: string) {
    if (!p) return;
    try {
      await api.del(`/attendance/${p.id}`, { note: reason });
      toast({ tone: 'success', title: 'Clock-out removed.', body: `${line.employee.name} is in again, clocked in at ${time(p.clockInAt)}.` });
      onSaved();
    } catch (e) { notifyFailure(e); }
  }

  return (
    <Modal title={`${p ? 'Fix times' : 'Key day'}: ${line.employee.name}`} sub={shownDay} onClose={onClose}
      footer={<>
        {p?.clockOutAt && (
          <ConfirmButton variant="tertiary" icon={<Icon name="Undo2" size="sm" />} style={{ marginRight: 'auto' }} onConfirm={remove}
            confirm={{ title: `Remove ${line.employee.name}'s clock-out?`, body: `The clock-out at ${time(p.clockOutAt)} is removed. They are in again with their own clock-in at ${time(p.clockInAt)} and can clock out again. The change is kept in the history.`,
              confirmLabel: 'Remove clock-out', reason: { label: 'Why is it removed?', placeholder: 'Clocked out by mistake' } }}>Remove clock-out</ConfirmButton>
        )}
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        {!p && <p className="m-0 text-copy text-muted-ink">No punch on this day. Key the times they worked; the day shows as keyed by the office, with no selfie or location.{line.leave ? ' They are on approved leave this day.' : ''}</p>}
        <div className="grid gap-x-4 gap-y-3 grid-cols-1 sm:grid-cols-2">
          <TimeField label="Clocked in" value={clockIn} onChange={setClockIn} required error={errors.clockIn} />
          <TimeField label="Clocked out" value={clockOut} onChange={setClockOut} error={errors.clockOut} help="Empty if they are still in." />
        </div>
        <label className="flex items-center gap-2.5 min-h-10 cursor-pointer">
          <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={outNextDay} onChange={e => setOutNextDay(e.target.checked)} />
          <span className="text-copy">Clocked out the next day (shift past midnight)</span>
        </label>
        <Field label={p ? 'Why the change' : 'Why the office keyed it'} value={note} onChange={e => setNote(e.target.value)}
          placeholder={p ? 'Forgot to clock out, left at 17:00' : 'Phone flat, at site from 08:00 (leader confirmed)'} error={errors.note ?? errors.date ?? errors.employeeId} />
        {p?.note && <p className="m-0 text-meta text-muted-ink">Last fix: {p.note}</p>}
      </div>
    </Modal>
  );
}
