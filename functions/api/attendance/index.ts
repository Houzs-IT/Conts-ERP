import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees } from '../../_lib/hr';
import type { Employee } from '../../_lib/hrFields';
import { hasAttendance, NOT_MIGRATED, buildings, toView, ROW_COLS, type AttendanceRow, type PunchView } from '../../_lib/attendance';
import { nearestBuilding, type Nearest } from '../../_lib/attendanceCalc';
import { hasLeaves } from '../../_lib/leave';
import type { LeaveType } from '../../_lib/leaveRules';

export interface AttendanceLine {
  employee: Pick<Employee, 'id' | 'name' | 'employeeId' | 'cleanerId' | 'technicianId' | 'isActive' | 'status'>;
  punch: PunchView | null;
  /** The closest building to where they clocked in and out; null without GPS or without buildings that have a location. */
  inPlace: Nearest | null;
  outPlace: Nearest | null;
  /** Approved leave covering the day, so "not in" reads "on leave". */
  leave: LeaveType | null;
}

/** GET /api/attendance?date=YYYY-MM-DD — everyone's punch on one Malaysia day (today by default), for HR > Workers >
 *  Attendance. Lists every active in-house person, punched or not, and anyone else who punched that day. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Attendance is kept by the office.', 403);
  if (!(await hasEmployees(env)) || !(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('date');
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;
  const [people, rows, sites, away] = await Promise.all([
    listEmployees(env),
    all<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE work_date = ?`, day),
    buildings(env),
    hasLeaves(env).then(ok => ok
      ? all<{ employee_id: string; type: LeaveType }>(env, `SELECT employee_id, type FROM leaves WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`, day, day)
      : []),
  ]);
  const byEmployee = new Map(rows.map(r => [r.employee_id, r]));
  const onLeave = new Map(away.map(l => [l.employee_id, l.type]));
  const at = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? nearestBuilding({ lat, lng }, sites) : null);

  const data: AttendanceLine[] = people
    .filter(p => (p.id && byEmployee.has(p.id)) || (p.isActive && p.status === 'active'))
    .map(p => {
      const r = p.id ? byEmployee.get(p.id) : undefined;
      return {
        employee: { id: p.id, name: p.name, employeeId: p.employeeId, cleanerId: p.cleanerId, technicianId: p.technicianId, isActive: p.isActive, status: p.status },
        punch: r ? toView(r, today) : null,
        inPlace: r ? at(r.in_lat, r.in_lng) : null,
        outPlace: r ? at(r.out_lat, r.out_lng) : null,
        leave: (p.id && onLeave.get(p.id)) || null,
      };
    });
  return json({ date: day, today, buildingsWithLocation: sites.length, data });
};
