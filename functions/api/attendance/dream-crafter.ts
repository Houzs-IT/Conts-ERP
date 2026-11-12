import { z } from 'zod';
import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasDcAppAccess, dcPeopleSql } from '../../_lib/dcStaff';
import type { EmployeeStatus } from '../../_lib/hrFields';
import { hasAttendance, NOT_MIGRATED, payslipLocked, toView, ROW_COLS, type AttendanceRow, type PunchView } from '../../_lib/attendance';
import { mytInstant } from '../../_lib/attendanceCalc';

const NOT_DC_MIGRATED = 'Dream Crafter attendance needs a database update (migration 0311) that has not been applied yet.';
const SIGN_IN_EXPIRED = 'Your session expired. Sign in to continue.';

/** The same shape as AttendanceLine (functions/api/attendance/index.ts), keyed by dcStaffId. Dream Crafter has no punch
 *  sites or leave yet, so the places and leave are always null. */
export interface DcAttendanceLine {
  employee: { id: string; dcStaffId: string; name: string; employeeId: string | null; isActive: boolean; status: EmployeeStatus };
  punch: PunchView | null;
  inPlace: null;
  outPlace: null;
  leave: null;
}

interface PersonRow { dc_staff_id: string; id: string; full_name: string; emp_no: string | null; roster_active: number; status: EmployeeStatus | null }

/** GET /api/attendance/dream-crafter?date=YYYY-MM-DD — every Dream Crafter employee's punch on one Malaysia day (today by
 *  default), for Dream Crafter > HR > Employees > Attendance. Lists everyone active and switched on, punched or not, and
 *  anyone else who punched that day. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response ?? fail('UNAUTHENTICATED', SIGN_IN_EXPIRED, 401);
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Attendance is kept by the office.', 403);
  if (!(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  if (!(await hasDcAppAccess(env))) return fail('NOT_MIGRATED', NOT_DC_MIGRATED, 503);

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('date');
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;
  const [people, rows] = await Promise.all([
    all<PersonRow>(env, `SELECT p.dc_staff_id, p.id, p.full_name, p.emp_no, p.roster_active, p.status FROM (${dcPeopleSql(true)}) p ORDER BY p.full_name`),
    all<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE work_date = ? AND employee_id IN (SELECT id FROM employees WHERE dc_staff_id IS NOT NULL)`, day),
  ]);
  const byEmployee = new Map(rows.map(row => [row.employee_id, row]));

  const data: DcAttendanceLine[] = people
    .filter(person => byEmployee.has(person.id) || (!!person.roster_active && (person.status ?? 'active') === 'active'))
    .map(person => {
      const row = byEmployee.get(person.id);
      return {
        employee: { id: person.id, dcStaffId: person.dc_staff_id, name: person.full_name, employeeId: person.emp_no, isActive: !!person.roster_active, status: person.status ?? 'active' },
        punch: row ? toView(row) : null, inPlace: null, outPlace: null, leave: null,
      };
    });
  return json({ date: day, today, buildingsWithLocation: 0, data });
};

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 08:30.');
const keyed = z.object({
  dcStaffId: z.string().min(1, 'Pick the person.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day.'),
  clockIn: hhmm,
  clockOut: hhmm.nullable(),
  /** Over midnight: the clock-out falls on the next day. */
  outNextDay: z.boolean().default(false),
  note: z.string().trim().min(3, 'Say why the office keyed this day.').max(300),
});

/** POST /api/attendance/dream-crafter { dcStaffId, date, clockIn, clockOut, outNextDay?, note } — the office keys a day for
 *  a Dream Crafter employee with no punch on it (forgot to clock in, phone lost), or fixes the times of a day already
 *  punched (a forgotten clock-out). No selfie or location on a keyed day: the row says who keyed it and why. Refused once
 *  that month's payslip is approved. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response ?? fail('UNAUTHENTICATED', SIGN_IN_EXPIRED, 401);
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include fixing attendance.', 403);
  if (!(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  if (!(await hasDcAppAccess(env))) return fail('NOT_MIGRATED', NOT_DC_MIGRATED, 503);

  const parsed = keyed.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0] ?? 'form'), issue.message])));
  }
  const { dcStaffId, date, clockIn, clockOut, outNextDay, note } = parsed.data;
  if (date > mytToday()) return fail('VALIDATION', 'Some fields need a fix.', 422, { date: 'A day in the future cannot be keyed.' });
  const inAt = mytInstant(date, clockIn);
  const outDay = outNextDay ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : date;
  const outAt = clockOut ? mytInstant(outDay, clockOut) : null;
  if (!inAt) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockIn: 'Use a time such as 08:30.' });
  if (outAt && outAt < inAt) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockOut: 'Clock-out is before clock-in. Tick "next day" for a shift past midnight.' });
  if (outAt && outAt > nowIso()) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockOut: 'That clock-out has not happened yet. Leave it empty while they are still in.' });

  const person = await one<{ id: string }>(env, 'SELECT id FROM employees WHERE dc_staff_id = ?', dcStaffId);
  if (!person) return fail('NOT_FOUND', 'That person is not a Dream Crafter employee.', 404);
  if (await payslipLocked(env, person.id, date)) {
    return fail('CONFLICT', `The payslip for ${date.slice(0, 7)} is already approved or paid. Reopen it before changing attendance.`, 409);
  }

  const before = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE employee_id = ? AND work_date = ?`, person.id, date);
  const now = nowIso();
  if (before) {
    await run(env, `
      UPDATE attendance SET clock_in_at = ?, clock_out_at = ?, forgot_out = ?, note = ?, edited_by = ?, updated_at = ? WHERE id = ?`,
      inAt, outAt, outAt ? 0 : before.forgot_out, note, session.userId, now, before.id);
    const after = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE id = ?`, before.id);
    if (!after) throw new Error(`The fixed times for Dream Crafter employee ${dcStaffId} on ${date} were not saved.`);
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'attendance.fix', entityTable: 'attendance', entityId: before.id,
      before: { clockInAt: before.clock_in_at, clockOutAt: before.clock_out_at, forgotOut: !!before.forgot_out },
      after: { clockInAt: after.clock_in_at, clockOutAt: after.clock_out_at, forgotOut: !!after.forgot_out, note },
    });
    return json({ data: toView(after) });
  }

  const id = crypto.randomUUID();
  // A punch landing at the same moment keeps the day: the office then fixes it rather than overwriting it.
  await run(env, `
    INSERT INTO attendance (id, employee_id, work_date, clock_in_at, clock_out_at, note, edited_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (employee_id, work_date) DO NOTHING`,
    id, person.id, date, inAt, outAt, note, session.userId, now, now);
  const row = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE employee_id = ? AND work_date = ?`, person.id, date);
  if (!row) throw new Error(`The keyed day for Dream Crafter employee ${dcStaffId} on ${date} was not saved.`);
  if (row.id !== id) return fail('CONFLICT', 'That day already has a punch. Fix its times instead.', 409);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'attendance.key_day', entityTable: 'attendance', entityId: id,
    after: { employeeId: person.id, date, clockInAt: inAt, clockOutAt: outAt, note },
  });
  return json({ data: toView(row) }, 201);
};
