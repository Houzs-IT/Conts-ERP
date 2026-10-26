import { mayWork } from '../../_lib/access';
import { type Env, all, json, fail, audit, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees } from '../../_lib/hr';
import type { Employee } from '../../_lib/hrFields';
import { hasAttendance } from '../../_lib/attendance';
import { workedMinutes } from '../../_lib/attendanceCalc';
import { readHolidays } from '../../_lib/leave';
import type { PublicHoliday } from '../../_lib/leaveRules';
import { readPayRules } from '../../_lib/payroll';
import { shiftDay } from '../../_lib/payrollCalc';
import { hasWorkingHours, NOT_MIGRATED, MAX_RANGE_DAYS, entriesBetween, saveBody, saveHours, homeDepartment, type Department, type HourEntry } from '../../_lib/workingHours';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)

export interface HoursPerson {
  id: string | null; cleanerId: string | null; technicianId: string | null; name: string; employeeId: string | null;
  hoursPerDay: number; home: Department; departments: Department[];
}
/** A phone punch in the range, with the hours it gives under today's pay rules (Hookka's hoursFromPunch). */
export interface HoursPunch { attendanceId: string; employeeId: string; date: string; clockInAt: string; clockOutAt: string | null; forgotOut: boolean; hours: number }
export interface HoursPayload { from: string; to: string; today: string; shiftRules: boolean; people: HoursPerson[]; entries: HourEntry[]; punches: HoursPunch[]; holidays: PublicHoliday[] }

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const mytMinute = (iso: string): number => Math.floor(Date.parse(iso) / 60_000 + 8 * 60) % (24 * 60);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** GET /api/working-hours?from&to — HR > Employees > Working Hours: everyone's logged hours in the range (this month by
 *  default, at most two months), their phone punches to fill from, and the public holidays. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Working hours are kept by the office.', 403);
  if (!(await hasEmployees(env)) || !(await hasWorkingHours(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const today = mytToday();
  const q = new URL(request.url).searchParams;
  const from = isDay(q.get('from')) ? String(q.get('from')) : `${today.slice(0, 7)}-01`;
  const to = isDay(q.get('to')) ? String(q.get('to')) : today;
  if (to < from) return fail('VALIDATION', 'The end date is before the start date.', 422, { to: 'Before the start.' });
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= MAX_RANGE_DAYS) {
    return fail('VALIDATION', `Pick at most ${MAX_RANGE_DAYS} days.`, 422, { to: `At most ${MAX_RANGE_DAYS} days.` });
  }

  const [everyone, entries, holidays, rules, punchRows] = await Promise.all([
    listEmployees(env), entriesBetween(env, from, to), readHolidays(env), readPayRules(env),
    hasAttendance(env).then(ok => ok ? all<{ id: string; employee_id: string; work_date: string; clock_in_at: string; clock_out_at: string | null; forgot_out: number }>(env,
      'SELECT id, employee_id, work_date, clock_in_at, clock_out_at, forgot_out FROM attendance WHERE work_date BETWEEN ? AND ?', from, to) : []),
  ]);
  const withRows = new Set([...entries.map(e => e.employeeId), ...punchRows.map(p => p.employee_id)]);
  const people: HoursPerson[] = everyone
    .filter((e: Employee) => (e.isActive && e.status === 'active') || (e.id && withRows.has(e.id)))
    .map(e => ({
      id: e.id, cleanerId: e.cleanerId, technicianId: e.technicianId, name: e.name, employeeId: e.employeeId, hoursPerDay: e.workingHoursPerDay,
      home: homeDepartment(e), departments: [e.cleanerId ? 'cleaning' as const : null, e.technicianId ? 'maintenance' as const : null].filter((d): d is Department => !!d),
    }));
  const hoursPerDay = new Map(people.map(p => [p.id, p.hoursPerDay]));

  const punches: HoursPunch[] = punchRows.map(r => {
    // An earlier day still open, or a forgotten clock-out, counts as the standard day, as payroll does.
    const forgotOut = !!r.forgot_out || (!r.clock_out_at && r.work_date < today);
    let minutes = forgotOut ? (hoursPerDay.get(r.employee_id) ?? 8) * 60 : workedMinutes(r.clock_in_at, r.clock_out_at);
    if (!forgotOut && rules.useShiftRules && r.clock_out_at) {
      const d = shiftDay(mytMinute(r.clock_in_at), mytMinute(r.clock_out_at), rules);
      minutes = d.regularMin + d.otMin;
    }
    return { attendanceId: r.id, employeeId: r.employee_id, date: r.work_date, clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, forgotOut, hours: round2(minutes / 60) };
  });
  const payload: HoursPayload = { from, to, today, shiftRules: rules.useShiftRules, people, entries, punches, holidays };
  return json(payload);
};

/** PUT /api/working-hours { rows, removed } — save the grid: every row written (one per employee, day and department),
 *  removed rows dropped. Payroll reads these hours from the next refresh. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include changing working hours.', 403);
  if (!(await hasWorkingHours(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const parsed = saveBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail('VALIDATION', i ? `Row ${Number(i.path[1] ?? 0) + 1}: ${i.message}` : 'Check the rows.', 422);
  }
  const { rows, removed } = parsed.data;
  const keys = rows.map(r => `${r.employeeId ?? r.cleanerId ?? r.technicianId}|${r.date}|${r.department}`);
  const twice = keys.find((k, i) => keys.indexOf(k) !== i);
  if (twice) return fail('VALIDATION', `The same person, day and department is in the grid twice (${twice.split('|')[1]}). Put the hours on one row.`, 422);

  const done = await saveHours(env, rows, removed, session.userId);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'hr.working_hours', entityTable: 'working_hour_entries', entityId: rows[0]?.date ?? 'removed',
    after: { ...done, dates: [...new Set(rows.map(r => r.date))].sort() },
  });
  return json(done);
};
