import { z } from 'zod';
import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees, employeeIdsFor } from '../../_lib/hr';
import type { Employee } from '../../_lib/hrFields';
import { hasAttendance, NOT_MIGRATED, punchSites, payslipLocked, toView, ROW_COLS, type AttendanceRow, type PunchView } from '../../_lib/attendance';
import { placeOf, mytInstant, type Nearest } from '../../_lib/attendanceCalc';
import { hasLeaves } from '../../_lib/leave';
import type { LeaveType } from '../../_lib/leaveRules';

export interface AttendanceLine {
  employee: Pick<Employee, 'id' | 'name' | 'employeeId' | 'cleanerId' | 'technicianId' | 'isActive' | 'status'>;
  punch: PunchView | null;
  /** Where they clocked in and out against the buildings and punch sites (placeOf); null without GPS or without a site. */
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
    punchSites(env),
    hasLeaves(env).then(ok => ok
      ? all<{ employee_id: string; type: LeaveType }>(env, `SELECT employee_id, type FROM leaves WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`, day, day)
      : []),
  ]);
  const byEmployee = new Map(rows.map(r => [r.employee_id, r]));
  const onLeave = new Map(away.map(l => [l.employee_id, l.type]));
  const at = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? placeOf({ lat, lng }, sites) : null);

  const data: AttendanceLine[] = people
    .filter(p => (p.id && byEmployee.has(p.id)) || (p.isActive && p.status === 'active'))
    .map(p => {
      const r = p.id ? byEmployee.get(p.id) : undefined;
      return {
        employee: { id: p.id, name: p.name, employeeId: p.employeeId, cleanerId: p.cleanerId, technicianId: p.technicianId, isActive: p.isActive, status: p.status },
        punch: r ? toView(r) : null,
        inPlace: r ? at(r.in_lat, r.in_lng) : null,
        outPlace: r ? at(r.out_lat, r.out_lng) : null,
        leave: (p.id && onLeave.get(p.id)) || null,
      };
    });
  return json({ date: day, today, sitesToCompare: sites.length, data });
};

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 08:30.');
const keyed = z.object({
  employeeId: z.string().min(1).nullish(),
  cleanerId: z.string().min(1).nullish(),
  technicianId: z.string().min(1).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day.'),
  clockIn: hhmm,
  clockOut: hhmm.nullable(),
  /** Over midnight: the clock-out falls on the next day. */
  outNextDay: z.boolean().default(false),
  note: z.string().trim().min(3, 'Say why the office keyed this day.').max(300),
});

/** POST /api/attendance { employeeId | cleanerId | technicianId, date, clockIn, clockOut, outNextDay?, note } — the office
 *  keys a day for someone with no punch on it (forgot to clock in, phone lost). No selfie or location: the row says who
 *  keyed it and why. A day already punched is fixed with PATCH instead. Refused once that month's payslip is approved. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include fixing attendance.', 403);
  if (!(await hasEmployees(env)) || !(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const parsed = keyed.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const k = parsed.data;
  if (!k.employeeId && !k.cleanerId && !k.technicianId) return fail('VALIDATION', 'Say whose day this is.', 422, { employeeId: 'Pick the person.' });
  if (k.date > mytToday()) return fail('VALIDATION', 'Some fields need a fix.', 422, { date: 'A day in the future cannot be keyed.' });
  const inAt = mytInstant(k.date, k.clockIn);
  const outDay = k.outNextDay ? new Date(Date.parse(`${k.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : k.date;
  const outAt = k.clockOut ? mytInstant(outDay, k.clockOut) : null;
  if (!inAt) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockIn: 'Use a time such as 08:30.' });
  if (outAt && outAt < inAt) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockOut: 'Clock-out is before clock-in. Tick "next day" for a shift past midnight.' });
  if (outAt && outAt > nowIso()) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockOut: 'That clock-out has not happened yet. Leave it empty while they are still in.' });

  let employeeId: string;
  try { [employeeId] = await employeeIdsFor(env, [{ employeeId: k.employeeId, cleanerId: k.cleanerId, technicianId: k.technicianId }]); }
  catch { return fail('NOT_FOUND', 'That person is not an in-house cleaner or technician.', 404); }
  if (await payslipLocked(env, employeeId, k.date)) {
    return fail('CONFLICT', `The payslip for ${k.date.slice(0, 7)} is already approved or paid. Reopen it before changing attendance.`, 409);
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  // A punch landing at the same moment keeps the day: the office then fixes it rather than overwriting it.
  await run(env, `
    INSERT INTO attendance (id, employee_id, work_date, clock_in_at, clock_out_at, note, edited_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (employee_id, work_date) DO NOTHING`,
    id, employeeId, k.date, inAt, outAt, k.note, session.userId, now, now);
  const row = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE employee_id = ? AND work_date = ?`, employeeId, k.date);
  if (!row) throw new Error('The keyed day was not saved.');
  if (row.id !== id) return fail('CONFLICT', 'That day already has a punch. Fix its times instead.', 409);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'attendance.key_day', entityTable: 'attendance', entityId: id,
    after: { employeeId, date: k.date, clockInAt: inAt, clockOutAt: outAt, note: k.note },
  });
  return json({ data: toView(row) }, 201);
};
