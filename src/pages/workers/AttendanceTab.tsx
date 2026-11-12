import { useSearchParams } from 'react-router-dom';
import { StaleBanner } from '../../components/DataState';
import { StatTile, StatRow } from '../../components/Metric';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm } from '../../lib/format';
import type { AttendanceLine } from '../../../functions/api/attendance/index';
import type { HoursPayload } from '../../../functions/api/working-hours/index';
import type { Employee } from '../../../functions/_lib/hrFields';
import { DayAttendance, type PunchTimes } from './attendanceParts';

/* ------------------------------------------------------------------ *
 * HR > Employees > Attendance: Hookka's Attendance tab. The month's
 * figures on top, then everyone on the day: when they punched, whether at
 * a building (within its radius, with a map link), and the selfies, or that
 * they are not in or on leave. The office fixes a forgotten clock-out or
 * keys a day nobody punched here; the portal's Clock screen is where
 * people punch.
 * ------------------------------------------------------------------ */

interface DayPayload { date: string; today: string; buildingsWithLocation: number; data: AttendanceLine[] }

const rowKey = (l: AttendanceLine): string => l.employee.id ?? l.employee.cleanerId ?? l.employee.technicianId ?? l.employee.name;
const photoPath = (punchId: string, side: 'in' | 'out'): string => `/api/attendance/${punchId}/photo/${side}`;

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

  const shown = data?.date ?? day ?? '';
  const setDay = (d: string) => setParams(p => { const n = new URLSearchParams(p); n.set('day', d); return n; }, { replace: true });

  const saveTimes = async (line: AttendanceLine, dayKeyed: string, times: PunchTimes): Promise<void> => {
    if (line.punch) await api.patch(`/attendance/${line.punch.id}`, times);
    else await api.post('/attendance', { ...times, date: dayKeyed, employeeId: line.employee.id, cleanerId: line.employee.cleanerId, technicianId: line.employee.technicianId });
  };
  const removeClockOut = async (punchId: string, reason: string): Promise<void> => { await api.del(`/attendance/${punchId}`, { note: reason }); };

  return (
    <div className="flex flex-col gap-5">
      {data && <MonthFigures day={shown} today={data.today} />}
      {error && <StaleBanner message={`Showing the last day we have. ${error}`} onRetry={reload} />}

      <DayAttendance<AttendanceLine>
        tableId="attendance" lines={data?.data ?? []} isLoading={loading} shown={shown} today={data?.today} onDayChange={setDay} onChanged={reload}
        rowKey={rowKey} mayFix={mayFix} photoPath={photoPath} onSave={saveTimes} onRemoveClockOut={removeClockOut}
        intro="Everyone active, punched or not. A phone punch shows where they were against the buildings; off-site = outside every building's radius (Punch Sites)."
        locationNote={data?.buildingsWithLocation === 0 ? ' · No building has a map location yet, so nobody can read as at a building.' : ''}
        empty={{ title: 'Nobody to list.', body: 'Attendance lists the in-house cleaners and technicians on Employee Master. People clock in and out on their phone, with a selfie and their location.' }}
      />
    </div>
  );
}
