import { type Env, all, json, fail, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasEmployees, employeeForUser, ensureEmployeeId } from '../../_lib/hr';
import { hasAttendance, NOT_MIGRATED, readPunch, clockIn, clockOut, toView, ROW_COLS, type AttendanceRow } from '../../_lib/attendance';

const NOT_ON_LIST = 'Clocking in is for the company\'s own cleaners and technicians. Ask the office to add you.';

/** GET /api/field/clock?month=YYYY-MM — the signed-in person's punch today and their days in the month (this month by
 *  default), for the portal's Clock screen. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasEmployees(env)) || !(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const me = await employeeForUser(env, session.userId);
  if (!me) return fail('FORBIDDEN', NOT_ON_LIST, 403);

  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('month');
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  const rows = me.id
    ? await all<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE employee_id = ? AND (work_date LIKE ? OR work_date = ?) ORDER BY work_date DESC`,
      me.id, `${month}-%`, today)
    : [];
  const days = rows.map(r => toView(r, today));
  const inMonth = days.filter(d => d.date.startsWith(month));
  return json({
    name: me.name, employeeId: me.employeeId, today: days.find(d => d.date === today) ?? null, month,
    days: inMonth, totals: { days: inMonth.length, minutes: inMonth.reduce((n, d) => n + d.minutes, 0), forgotten: inMonth.filter(d => d.forgotOut).length },
  });
};

/** POST /api/field/clock (multipart) action=in|out, photo, lat?, lng?, accuracy? — clock in or out. The selfie is
 *  required (owner, 27 Oct 2026); the location is kept when the phone sends it and never stops the punch. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasEmployees(env)) || !(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const me = await employeeForUser(env, session.userId);
  if (!me) return fail('FORBIDDEN', NOT_ON_LIST, 403);
  if (me.status === 'resigned') return fail('FORBIDDEN', 'Your employee record says you have left. Ask the office if that is wrong.', 403);

  const sent = await readPunch(request);
  if ('error' in sent) return fail('VALIDATION', sent.error, 422);
  if (!sent.punch.photo) return fail('VALIDATION', 'A selfie is needed to clock in or out. If your camera does not work, ask the office to fix your time.', 422);
  const employeeId = await ensureEmployeeId(env, me);
  const done = sent.action === 'in'
    ? await clockIn(env, employeeId, session.userId, sent.punch)
    : await clockOut(env, employeeId, session.userId, sent.punch);
  if ('error' in done) return fail('CONFLICT', done.error, done.status);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: sent.action === 'in' ? 'attendance.clock_in' : 'attendance.clock_out',
    entityTable: 'attendance', entityId: done.row.id, source: 'field_app',
    after: { date: done.row.work_date, gps: sent.punch.lat !== null, photo: !!sent.punch.photo, photoKept: done.photoKept, closedForgotten: done.closedForgotten },
  });
  return json({ data: toView(done.row), photoKept: done.photoKept, closedForgotten: done.closedForgotten }, sent.action === 'in' ? 201 : 200);
};
