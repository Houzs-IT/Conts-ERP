import { type Env, all, one } from './db';
import { hasColumn } from './auth';
import type { Employee } from './hrFields';
import { ALLOWANCE_TYPES, balance, chargeableDays, parseHolidays, type Balance, type LeaveStatus, type LeaveType, type PublicHoliday } from './leaveRules';

/** Leave on the database (migration 0164, PLAN-hr-employees.md phase 3). The rules themselves are in leaveRules.ts. */

export const hasLeaves = (env: Env): Promise<boolean> => hasColumn(env, 'leaves', 'id').catch(() => false);
export const NOT_MIGRATED = 'Leave needs a database update (migration 0164) that has not been applied yet.';
export const HOLIDAYS_KEY = 'hr.public_holidays';

export async function readHolidays(env: Env): Promise<PublicHoliday[]> {
  const row = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', HOLIDAYS_KEY);
  return parseHolidays(row?.value);
}

interface Row {
  id: string; employee_id: string; type: LeaveType; start_date: string; end_date: string; days: number; reason: string | null;
  status: LeaveStatus; decided_at: string | null; decision_note: string | null; decided_by_name: string | null; created_at: string;
}
export const LEAVE_SELECT = `
  SELECT l.id, l.employee_id, l.type, l.start_date, l.end_date, l.days, l.reason, l.status, l.decided_at, l.decision_note,
         d.full_name AS decided_by_name, l.created_at
  FROM leaves l LEFT JOIN users d ON d.id = l.decided_by`;

/** One request as the portal and the desk show it. `chargeable` is the days it takes from an allowance. */
export interface LeaveView {
  id: string; employeeId: string; type: LeaveType; startDate: string; endDate: string; days: number; chargeable: number;
  reason: string | null; status: LeaveStatus; decidedAt: string | null; decisionNote: string | null; decidedBy: string | null; createdAt: string;
}
export const toLeave = (r: Row, holidays: readonly PublicHoliday[]): LeaveView => ({
  id: r.id, employeeId: r.employee_id, type: r.type, startDate: r.start_date, endDate: r.end_date, days: r.days,
  chargeable: chargeableDays({ startDate: r.start_date, endDate: r.end_date, days: r.days }, holidays),
  reason: r.reason, status: r.status, decidedAt: r.decided_at, decisionNote: r.decision_note, decidedBy: r.decided_by_name, createdAt: r.created_at,
});

/** Requests whose start falls in `year`, plus every pending one (an old pending request must not drop out of sight). */
export async function leavesInYear(env: Env, year: number, employeeId?: string): Promise<Row[]> {
  return all<Row>(env, `${LEAVE_SELECT}
    WHERE (l.start_date LIKE ? OR l.status = 'pending') ${employeeId ? 'AND l.employee_id = ?' : ''}
    ORDER BY l.start_date DESC, l.created_at DESC`, `${year}-%`, ...(employeeId ? [employeeId] : []));
}

export async function leaveById(env: Env, id: string): Promise<Row | null> {
  return one<Row>(env, `${LEAVE_SELECT} WHERE l.id = ?`, id);
}

/** A pending or approved request of this person that shares a day with [start, end]. */
export async function overlapping(env: Env, employeeId: string, start: string, end: string, exceptId?: string): Promise<{ start_date: string; end_date: string } | null> {
  return one(env, `
    SELECT start_date, end_date FROM leaves
    WHERE employee_id = ? AND status IN ('pending','approved') AND start_date <= ? AND end_date >= ? AND id IS DISTINCT FROM ?
    LIMIT 1`, employeeId, end, start, exceptId ?? null);
}

/** Annual and medical balances for one person in one year. */
export function balancesFor(e: Pick<Employee, 'joinDate' | 'annualLeaveDays' | 'medicalLeaveDays'>, leaves: readonly LeaveView[], year: number, holidays: readonly PublicHoliday[], today: string): Balance[] {
  return ALLOWANCE_TYPES.map(t => balance(t, e, leaves, year, holidays, today));
}
