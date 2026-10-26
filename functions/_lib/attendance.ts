import { type Env, all, one, run, nowIso, mytToday } from './db';
import { hasColumn } from './auth';
import { mediaKind } from './media';
import { coord, workedMinutes, type Building } from './attendanceCalc';

/**
 * Clocking in and out (migration 0163, PLAN-hr-employees.md phase 2), ported from Hookka's POST /api/worker/clock.
 * Soft like Hookka: GPS and the selfie are recorded when the phone gives them, and never stop a punch.
 */

export const hasAttendance = (env: Env): Promise<boolean> => hasColumn(env, 'attendance', 'id').catch(() => false);
export const NOT_MIGRATED = 'Attendance needs a database update (migration 0163) that has not been applied yet.';

export interface AttendanceRow {
  id: string; employee_id: string; work_date: string; clock_in_at: string; clock_out_at: string | null;
  in_lat: number | null; in_lng: number | null; in_accuracy_m: number | null;
  out_lat: number | null; out_lng: number | null; out_accuracy_m: number | null;
  in_photo_id: string | null; out_photo_id: string | null; forgot_out: number; note: string | null;
}
export const ROW_COLS = `id, employee_id, work_date, clock_in_at, clock_out_at, in_lat, in_lng, in_accuracy_m, out_lat, out_lng,
  out_accuracy_m, in_photo_id, out_photo_id, forgot_out, note`;

/** What the phone sent with a punch. Every part may be missing. */
export interface Punch { lat: number | null; lng: number | null; accuracy: number | null; photo: File | null }

export async function readPunch(request: Request): Promise<{ action: 'in' | 'out'; punch: Punch } | { error: string }> {
  const form = await request.formData().catch(() => null);
  if (!form) return { error: 'Send the punch as a form.' };
  const action = form.get('action');
  if (action !== 'in' && action !== 'out') return { error: 'Say whether this is a clock-in or a clock-out.' };
  const photo = form.get('photo');
  const lat = coord(form.get('lat'), 90), lng = coord(form.get('lng'), 180);
  const accRaw = form.get('accuracy');
  const acc = typeof accRaw === 'string' && accRaw.trim() ? Number(accRaw) : NaN;
  return {
    action,
    punch: {
      // Half a location is no location.
      lat: lat !== null && lng !== null ? lat : null, lng: lat !== null && lng !== null ? lng : null,
      accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null,
      photo: photo instanceof File && photo.size > 0 ? photo : null,
    },
  };
}

/** Every building with a location, for "nearest building" on the desk. */
export async function buildings(env: Env): Promise<Building[]> {
  return all<Building>(env, 'SELECT id, name, latitude AS lat, longitude AS lng FROM properties WHERE latitude IS NOT NULL AND longitude IS NOT NULL');
}

/** Stores a punch selfie in R2 like a job photo. Null when storage is not set up or the file is not a photo, so the punch
 *  still counts; the caller reports that the photo was not kept. */
async function savePhoto(env: Env, attendanceId: string, side: 'in' | 'out', file: File, userId: string): Promise<string | null> {
  if (!env.MEDIA) return null;
  const media = mediaKind(file);
  if ('error' in media || media.kind !== 'photo') return null;
  const docId = crypto.randomUUID();
  const key = `attendance/${attendanceId}/${docId}`;
  await env.MEDIA.put(key, file, { httpMetadata: { contentType: file.type } });
  const now = nowIso();
  await run(env, `
    INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, uploaded_by, captured_at, created_at)
    VALUES (?, 'photo', ?, ?, ?, ?, ?, ?, ?)`, docId, `clock-${side}.jpg`, file.type, file.size, key, userId, now, now);
  await run(env, `UPDATE attendance SET ${side === 'in' ? 'in_photo_id' : 'out_photo_id'} = ? WHERE id = ?`, docId, attendanceId);
  return docId;
}

export type PunchResult = { row: AttendanceRow; photoKept: boolean; closedForgotten: number } | { error: string; status: number };

/**
 * Clock in for today (Malaysia day). An earlier day still open is closed as a forgotten clock-out first (Hookka rule:
 * payroll pays it as a normal shift). One punch-in a day: a second one is refused, not merged.
 */
export async function clockIn(env: Env, employeeId: string, userId: string, p: Punch): Promise<PunchResult> {
  const today = mytToday();
  const now = nowIso();
  const closed = await all<{ id: string }>(env, `
    UPDATE attendance SET forgot_out = 1, updated_at = ? WHERE employee_id = ? AND work_date < ? AND clock_out_at IS NULL RETURNING id`,
    now, employeeId, today);
  const id = crypto.randomUUID();
  // Two taps at once: the unique day keeps one row, and the second tap is told it is already in.
  await run(env, `
    INSERT INTO attendance (id, employee_id, work_date, clock_in_at, in_lat, in_lng, in_accuracy_m, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (employee_id, work_date) DO NOTHING`,
    id, employeeId, today, now, p.lat, p.lng, p.accuracy, now, now);
  const row = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE employee_id = ? AND work_date = ?`, employeeId, today);
  if (!row) throw new Error('The clock-in was not saved.');
  if (row.id !== id) {
    return row.clock_out_at
      ? { error: 'You already clocked in and out today. Ask the office to fix your times if that is wrong.', status: 409 }
      : { error: 'You are already clocked in today.', status: 409 };
  }
  const photoId = p.photo ? await savePhoto(env, id, 'in', p.photo, userId) : null;
  return { row: { ...row, in_photo_id: photoId }, photoKept: !p.photo || !!photoId, closedForgotten: closed.length };
}

/** Clock out of today's punch, or of yesterday's when a shift ran past midnight. */
export async function clockOut(env: Env, employeeId: string, userId: string, p: Punch): Promise<PunchResult> {
  const today = mytToday();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const open = await one<AttendanceRow>(env, `
    SELECT ${ROW_COLS} FROM attendance WHERE employee_id = ? AND clock_out_at IS NULL AND forgot_out = 0 AND work_date >= ? ORDER BY work_date DESC LIMIT 1`,
    employeeId, yesterday);
  if (!open) return { error: 'You are not clocked in. Clock in first.', status: 409 };
  const now = nowIso();
  await run(env, `
    UPDATE attendance SET clock_out_at = ?, out_lat = ?, out_lng = ?, out_accuracy_m = ?, updated_at = ? WHERE id = ? AND clock_out_at IS NULL`,
    now, p.lat, p.lng, p.accuracy, now, open.id);
  const photoId = p.photo ? await savePhoto(env, open.id, 'out', p.photo, userId) : null;
  const row = await one<AttendanceRow>(env, `SELECT ${ROW_COLS} FROM attendance WHERE id = ?`, open.id);
  if (!row) throw new Error('The clock-out was not saved.');
  return { row, photoKept: !p.photo || !!photoId, closedForgotten: 0 };
}

/** One punch as the portal and the desk show it. */
export interface PunchView {
  id: string; date: string; clockInAt: string; clockOutAt: string | null; minutes: number; forgotOut: boolean; note: string | null;
  inPhoto: boolean; outPhoto: boolean; inGps: boolean; outGps: boolean;
}
export function toView(r: AttendanceRow, today = mytToday()): PunchView {
  // An earlier day with no clock-out has no end to count to: it reads as forgotten until someone fixes the times, and
  // payroll treats it as a normal shift. Only today's open punch counts up.
  const forgotOut = !!r.forgot_out || (!r.clock_out_at && r.work_date < today);
  return {
    id: r.id, date: r.work_date, clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at,
    minutes: forgotOut ? 0 : workedMinutes(r.clock_in_at, r.clock_out_at), forgotOut, note: r.note,
    inPhoto: !!r.in_photo_id, outPhoto: !!r.out_photo_id, inGps: r.in_lat !== null, outGps: r.out_lat !== null,
  };
}
