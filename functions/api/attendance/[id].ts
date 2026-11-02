import { z } from 'zod';
import { mayWork } from '../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasAttendance, NOT_MIGRATED, payslipLocked, toView, ROW_COLS, type AttendanceRow } from '../../_lib/attendance';
import { mytInstant } from '../../_lib/attendanceCalc';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 08:30.');
const fix = z.object({
  clockIn: hhmm,
  clockOut: hhmm.nullable(),
  /** Over midnight: the clock-out falls on the next day. */
  outNextDay: z.boolean().default(false),
  note: z.string().trim().min(3, 'Say why the times changed.').max(300),
});

/** PATCH /api/attendance/:id { clockIn, clockOut, outNextDay?, note } — the office fixes a punch's times (a forgotten
 *  clock-out, a phone that died). The note says why; the history keeps the times before and after. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include fixing attendance.', 403);
  if (!(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const before = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE id = ?`, String(params.id));
  if (!before) return fail('NOT_FOUND', 'That day is not on record.', 404);
  const parsed = fix.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const { clockIn, clockOut, outNextDay, note } = parsed.data;
  const inAt = mytInstant(before.work_date, clockIn);
  const outDay = outNextDay ? new Date(Date.parse(`${before.work_date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : before.work_date;
  const outAt = clockOut ? mytInstant(outDay, clockOut) : null;
  if (!inAt) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockIn: 'Use a time such as 08:30.' });
  if (outAt && outAt < inAt) return fail('VALIDATION', 'Some fields need a fix.', 422, { clockOut: 'Clock-out is before clock-in. Tick "next day" for a shift past midnight.' });

  await run(env, `
    UPDATE attendance SET clock_in_at = ?, clock_out_at = ?, forgot_out = ?, note = ?, edited_by = ?, updated_at = ? WHERE id = ?`,
    inAt, outAt, outAt ? 0 : before.forgot_out, note, session.userId, nowIso(), before.id);
  const after = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE id = ?`, before.id);
  if (!after) throw new Error('The fixed times were not saved.');
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'attendance.fix', entityTable: 'attendance', entityId: before.id,
    before: { clockInAt: before.clock_in_at, clockOutAt: before.clock_out_at, forgotOut: !!before.forgot_out },
    after: { clockInAt: after.clock_in_at, clockOutAt: after.clock_out_at, forgotOut: !!after.forgot_out, note },
  });
  return json({ data: toView(after) });
};

const removal = z.object({ note: z.string().trim().min(3, 'Say why the clock-out is removed.').max(300) });

/** DELETE /api/attendance/:id { note } — the office removes a punch's clock-out (pressed by mistake): the person is "in
 *  now" again with their own clock-in, and can clock out again. The clock-out's location and selfie are cleared from the
 *  row (the photo file stays in storage, unreachable). Refused once that month's payslip is approved or paid. The audit
 *  log keeps the removed clock-out, its photo id and the reason. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include fixing attendance.', 403);
  if (!(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const before = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE id = ?`, String(params.id));
  if (!before) return fail('NOT_FOUND', 'That day is not on record.', 404);
  if (!before.clock_out_at) return fail('CONFLICT', 'There is no clock-out on that day to remove.', 409);
  const parsed = removal.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('VALIDATION', 'Some fields need a fix.', 422, { note: parsed.error.issues[0]?.message ?? 'Say why the clock-out is removed.' });

  if (await payslipLocked(env, before.employee_id, before.work_date)) return fail('CONFLICT', `The payslip for ${before.work_date.slice(0, 7)} is already approved or paid. Reopen it before changing attendance.`, 409);

  await run(env, `
    UPDATE attendance SET clock_out_at = NULL, out_lat = NULL, out_lng = NULL, out_accuracy_m = NULL, out_photo_id = NULL, forgot_out = 0,
      note = ?, edited_by = ?, updated_at = ? WHERE id = ?`, parsed.data.note, session.userId, nowIso(), before.id);
  const after = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE id = ?`, before.id);
  if (!after) throw new Error('The removal of the clock-out was not saved.');
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'attendance.remove_clock_out', entityTable: 'attendance', entityId: before.id,
    before: { clockInAt: before.clock_in_at, clockOutAt: before.clock_out_at, outPhotoId: before.out_photo_id, forgotOut: !!before.forgot_out },
    after: { clockInAt: after.clock_in_at, clockOutAt: null, reason: parsed.data.note },
  });
  return json({ data: toView(after) });
};
