import { z } from 'zod';
import { type Env, all, run, nowIso } from './db';
import { hasColumn } from './auth';
import { employeeIdsFor } from './hr';
import { DEPARTMENTS, type Department, type Employee } from './hrFields';

export { DEPARTMENTS, DEPARTMENT_LABEL, type Department } from './hrFields';

/**
 * Working Hours (migration 0168): the hours each employee worked per day per department, as Hookka keeps them
 * (working_hour_entries). The office keys or corrects them on HR > Employees > Working Hours, starting from the phone
 * punches; payroll reads them (payroll.ts monthInputs).
 */

export const hasWorkingHours = (env: Env): Promise<boolean> => hasColumn(env, 'working_hour_entries', 'id').catch(() => false);
export const NOT_MIGRATED = 'Working Hours needs a database update (migration 0168) that has not been applied yet.';
/** The longest range the grid reads at once: two months. */
export const MAX_RANGE_DAYS = 62;

export interface HourEntry { id: string; employeeId: string; date: string; department: Department; hours: number; notes: string | null; attendanceId: string | null; updatedAt: string }

export async function entriesBetween(env: Env, from: string, to: string): Promise<HourEntry[]> {
  const rows = await all<{ id: string; employee_id: string; work_date: string; department: Department; hours: number; notes: string | null; attendance_id: string | null; updated_at: string }>(env, `
    SELECT id, employee_id, work_date, department, hours, notes, attendance_id, updated_at
    FROM working_hour_entries WHERE work_date BETWEEN ? AND ? ORDER BY work_date, employee_id, department`, from, to);
  return rows.map(r => ({ id: r.id, employeeId: r.employee_id, date: r.work_date, department: r.department, hours: Number(r.hours), notes: r.notes, attendanceId: r.attendance_id, updatedAt: r.updated_at }));
}

/** One grid row as the screen sends it. A person without an HR record yet is named by their roster id. */
export const hourRow = z.object({
  employeeId: z.string().nullable().default(null),
  cleanerId: z.string().nullable().default(null),
  technicianId: z.string().nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  department: z.enum(DEPARTMENTS),
  hours: z.number().min(0, 'Hours cannot be negative.').max(24, 'At most 24 hours a day.'),
  notes: z.string().trim().max(200).transform(v => v || null).nullable().default(null),
  attendanceId: z.string().nullable().default(null),
}).refine(r => !!(r.employeeId || r.cleanerId || r.technicianId), { path: ['employeeId'], message: 'Pick an employee.' });
export const saveBody = z.object({
  rows: z.array(hourRow).max(1000),
  /** Saved rows the office deleted, or moved to another day or department (sent again in `rows`). */
  removed: z.array(z.string()).max(1000).default([]),
});
export type HourRow = z.infer<typeof hourRow>;

/**
 * Save the grid in one go: drop the removed rows, make an HR record for anyone who has none yet, then write every row
 * (one per employee, day and department; a second save of the same day replaces it). Three statements whatever the size.
 */
export async function saveHours(env: Env, rows: HourRow[], removed: string[], userId: string): Promise<{ saved: number; removed: number }> {
  const now = nowIso();
  if (removed.length) await run(env, `DELETE FROM working_hour_entries WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(removed));
  if (!rows.length) return { saved: 0, removed: removed.length };

  // People keyed by roster id get their HR record now (the grid can log hours before anyone saved one).
  const ids = await employeeIdsFor(env, rows);
  const records = rows.map((r, i) => ({
    id: crypto.randomUUID(), employee_id: ids[i], work_date: r.date, department: r.department, hours: r.hours, notes: r.notes, attendance_id: r.attendanceId,
  }));
  await run(env, `
    INSERT INTO working_hour_entries (id, employee_id, work_date, department, hours, notes, attendance_id, created_by, updated_by, created_at, updated_at)
    SELECT r.id, r.employee_id, r.work_date, r.department, r.hours, r.notes, r.attendance_id, ?, ?, ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS r(id text, employee_id text, work_date text, department text, hours numeric, notes text, attendance_id text)
    ON CONFLICT (employee_id, work_date, department) DO UPDATE
      SET hours = excluded.hours, notes = excluded.notes, attendance_id = COALESCE(excluded.attendance_id, working_hour_entries.attendance_id),
          updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    userId, userId, now, now, JSON.stringify(records));
  return { saved: records.length, removed: removed.length };
}

/** The department a person's punch is filed under before anyone splits the day: Cleaning when they are on both lists. */
export const homeDepartment = (e: Pick<Employee, 'cleanerId' | 'technicianId'>): Department => (e.cleanerId ? 'cleaning' : 'maintenance');
