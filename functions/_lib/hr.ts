import { type Env, all, one, run, nowIso } from './db';
import { hasColumn } from './auth';
import { EMPLOYEE_DEFAULTS, type Bank, type Employee, type EmployeeStatus, type PayBasis, type PaymentMethod, type TaxCategory, type TaxResidency } from './hrFields';

/**
 * The employee record (migration 0162, PLAN-hr-employees.md): the HR side of an in-house cleaner or technician,
 * ported from Hookka's Employee Master. The database side; the fields and their rules are in hrFields.ts.
 */

export const hasEmployees = (env: Env): Promise<boolean> => hasColumn(env, 'employees', 'id').catch(() => false);

/**
 * Every in-house person on the two rosters, one row each: an in-house cleaner (with the in-house technician entry of the
 * same login, if any), then each in-house technician who is not also a cleaner. Each gets the HR record that holds either
 * of their ids, preferring the one on the cleaner when two exist.
 */
const PEOPLE = `
  WITH people AS (
    SELECT c.id AS cleaner_id, t.id AS technician_id, c.full_name, c.phone, c.user_id, c.is_active
    FROM cleaners c LEFT JOIN technicians t ON t.user_id = c.user_id AND t.employment_type = 'internal'
    WHERE c.employment_type = 'internal'
    UNION ALL
    SELECT NULL, t.id, t.full_name, t.phone, t.user_id, t.is_active
    FROM technicians t
    WHERE t.employment_type = 'internal'
      AND NOT EXISTS (SELECT 1 FROM cleaners c WHERE c.employment_type = 'internal' AND c.user_id = t.user_id)
  )
  SELECT p.cleaner_id AS p_cleaner_id, p.technician_id AS p_technician_id, p.full_name, p.phone, p.is_active, u.employee_id, e.*
  FROM people p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN LATERAL (
    SELECT * FROM employees e WHERE e.cleaner_id = p.cleaner_id OR e.technician_id = p.technician_id
    ORDER BY COALESCE(e.cleaner_id = p.cleaner_id, false) DESC LIMIT 1
  ) e ON true`;

interface Row {
  p_cleaner_id: string | null; p_technician_id: string | null; full_name: string; phone: string | null; is_active: number; employee_id: string | null;
  id: string | null; position: string | null; nationality: string | null; join_date: string | null;
  leader_allowance_sen: number | null; efficiency_allowance_sen: number | null; efficiency_threshold_pct: number | null;
  status: EmployeeStatus | null; resigned_at: string | null; pay_basis: PayBasis | null; basic_salary_sen: number | null; daily_rate_sen: number | null;
  working_days_per_month: number | null; working_hours_per_day: number | null; ot_multiplier: number | null;
  payment_method: PaymentMethod | null; bank_name: Bank | null; bank_account: string | null;
  epf_enabled: number | null; socso_enabled: number | null; eis_enabled: number | null; pcb_enabled: number | null;
  tax_residency: TaxResidency | null; tax_category: TaxCategory | null; tax_child_relief_sen: number | null;
  annual_leave_days: number | null; medical_leave_days: number | null;
}

function toEmployee(r: Row): Employee {
  const d = EMPLOYEE_DEFAULTS;
  return {
    id: r.id, cleanerId: r.p_cleaner_id, technicianId: r.p_technician_id, name: r.full_name, phone: r.phone,
    employeeId: r.employee_id, isActive: !!r.is_active,
    // Free text saved before the Leader tick ("Cleaning leader") reads as a leader when it says so.
    position: r.position?.toLowerCase().includes('leader') ? 'leader' : 'employee', nationality: r.nationality, joinDate: r.join_date,
    // Read before migration 0167 the columns are missing: the record's defaults apply.
    leaderAllowanceSen: r.leader_allowance_sen ?? d.leaderAllowanceSen, efficiencyAllowanceSen: r.efficiency_allowance_sen ?? d.efficiencyAllowanceSen,
    efficiencyThresholdPct: r.efficiency_threshold_pct ?? d.efficiencyThresholdPct,
    status: r.status ?? d.status, resignedAt: r.resigned_at, payBasis: r.pay_basis ?? d.payBasis,
    basicSalarySen: r.basic_salary_sen ?? d.basicSalarySen, dailyRateSen: r.daily_rate_sen ?? d.dailyRateSen,
    workingDaysPerMonth: r.working_days_per_month ?? d.workingDaysPerMonth, workingHoursPerDay: r.working_hours_per_day ?? d.workingHoursPerDay,
    otMultiplier: r.ot_multiplier ?? d.otMultiplier, paymentMethod: r.payment_method ?? d.paymentMethod,
    bankName: r.bank_name, bankAccount: r.bank_account,
    epfEnabled: !!r.epf_enabled, socsoEnabled: !!r.socso_enabled, eisEnabled: !!r.eis_enabled, pcbEnabled: !!r.pcb_enabled,
    taxResidency: r.tax_residency, taxCategory: r.tax_category, taxChildReliefSen: r.tax_child_relief_sen,
    annualLeaveDays: r.annual_leave_days, medicalLeaveDays: r.medical_leave_days,
  };
}

/** Everyone on the Employees tab, switched-off roster entries last. */
export async function listEmployees(env: Env): Promise<Employee[]> {
  const rows = await all<Row>(env, `${PEOPLE} ORDER BY p.is_active DESC, p.full_name`);
  return rows.map(toEmployee);
}

/** One person, found by either roster id. Null when neither is an in-house roster entry. */
export async function findEmployee(env: Env, by: { cleanerId?: string | null; technicianId?: string | null }): Promise<Employee | null> {
  const row = by.cleanerId
    ? await one<Row>(env, `${PEOPLE} WHERE p.cleaner_id = ?`, by.cleanerId)
    : by.technicianId ? await one<Row>(env, `${PEOPLE} WHERE p.technician_id = ?`, by.technicianId) : null;
  return row ? toEmployee(row) : null;
}

/** The in-house person a login belongs to (from "Give app access" on either roster). Null for anyone else. */
export async function employeeForUser(env: Env, userId: string): Promise<Employee | null> {
  const row = await one<Row>(env, `${PEOPLE} WHERE p.user_id = ?`, userId);
  return row ? toEmployee(row) : null;
}

/** The HR record's id, making the row with the defaults if nobody has saved one yet (a first clock-in). Two requests at
 *  once both land on the one row: the roster ids are unique. */
export async function ensureEmployeeId(env: Env, e: Employee): Promise<string> {
  if (e.id) return e.id;
  const now = nowIso();
  await run(env, `INSERT INTO employees (id, cleaner_id, technician_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    crypto.randomUUID(), e.cleanerId, e.technicianId, now, now);
  const made = await findEmployee(env, e);
  if (!made?.id) throw new Error(`No employee record could be made for ${e.name}.`);
  return made.id;
}
