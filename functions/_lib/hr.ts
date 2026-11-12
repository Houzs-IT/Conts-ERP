import { type Env, all, one, run, nowIso, mytToday } from './db';
import { hasColumn } from './auth';
import { EMPLOYEE_DEFAULTS, type Bank, type Employee, type EmployeeInput, type EmployeeStatus, type PayBasis, type PaymentMethod, type TaxCategory, type TaxResidency } from './hrFields';
import { hasPayroll } from './payroll';

/**
 * The employee record (migration 0165, PLAN-hr-employees.md): the HR side of an in-house cleaner or technician,
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
    SELECT c.id AS cleaner_id, t.id AS technician_id, c.full_name, c.phone, c.user_id, GREATEST(c.is_active, COALESCE(t.is_active, 0)) AS is_active,
      c.is_active AS cleaner_active, t.is_active AS technician_active
    FROM cleaners c LEFT JOIN technicians t ON t.user_id = c.user_id AND t.employment_type = 'internal'
    WHERE c.employment_type = 'internal'
    UNION ALL
    SELECT NULL, t.id, t.full_name, t.phone, t.user_id, t.is_active, NULL, t.is_active
    FROM technicians t
    WHERE t.employment_type = 'internal'
      AND NOT EXISTS (SELECT 1 FROM cleaners c WHERE c.employment_type = 'internal' AND c.user_id = t.user_id)
  )
  SELECT p.cleaner_id AS p_cleaner_id, p.technician_id AS p_technician_id, p.full_name, p.phone, p.is_active, p.cleaner_active, p.technician_active, p.user_id AS p_user_id, u.employee_id, e.*
  FROM people p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN LATERAL (
    SELECT * FROM employees e WHERE e.cleaner_id = p.cleaner_id OR e.technician_id = p.technician_id
    ORDER BY COALESCE(e.cleaner_id = p.cleaner_id, false) DESC LIMIT 1
  ) e ON true`;

/** The employees table's record columns, as a row carries them (null before migration 0170 or before the first save). */
export interface EmployeeRecordRow {
  id: string | null; position: string | null; nationality: string | null; join_date: string | null;
  leader_allowance_sen: number | null; efficiency_allowance_sen: number | null; efficiency_threshold_pct: number | null;
  status: EmployeeStatus | null; resigned_at: string | null; pay_basis: PayBasis | null; basic_salary_sen: number | null; daily_rate_sen: number | null;
  working_days_per_month: number | null; working_hours_per_day: number | null; ot_multiplier: number | null;
  payment_method: PaymentMethod | null; bank_name: Bank | null; bank_account: string | null;
  epf_enabled: number | null; socso_enabled: number | null; eis_enabled: number | null; pcb_enabled: number | null;
  tax_residency: TaxResidency | null; tax_category: TaxCategory | null; tax_child_relief_sen: number | null;
  annual_leave_days: number | null; medical_leave_days: number | null;
}

interface Row extends EmployeeRecordRow {
  p_cleaner_id: string | null; p_technician_id: string | null; full_name: string; phone: string | null; is_active: number; employee_id: string | null;
  cleaner_active: number | null; technician_active: number | null; p_user_id: string | null;
}

export function toEmployeeRecord(r: EmployeeRecordRow): EmployeeInput {
  const d = EMPLOYEE_DEFAULTS;
  return {
    // Free text saved before the Leader tick ("Cleaning leader") reads as a leader when it says so.
    position: r.position?.toLowerCase().includes('leader') ? 'leader' : 'employee', nationality: r.nationality, joinDate: r.join_date,
    // Read before migration 0170 the columns are missing: the record's defaults apply.
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

function toEmployee(r: Row): Employee {
  return {
    id: r.id, cleanerId: r.p_cleaner_id, technicianId: r.p_technician_id, name: r.full_name, phone: r.phone,
    employeeId: r.employee_id, isActive: !!r.is_active, cleanerActive: !!r.cleaner_active, technicianActive: !!r.technician_active, userId: r.p_user_id,
    ...toEmployeeRecord(r),
  };
}

export function employeeRecordColumns(e: EmployeeInput): [string, unknown][] {
  // Resigned people keep their record; an active one has no last day.
  const resignedAt = e.status === 'resigned' ? e.resignedAt : null;
  return [
    ['position', e.position], ['nationality', e.nationality], ['join_date', e.joinDate],
    ['status', e.status], ['resigned_at', resignedAt], ['pay_basis', e.payBasis], ['basic_salary_sen', e.basicSalarySen],
    ['daily_rate_sen', e.dailyRateSen], ['working_days_per_month', e.workingDaysPerMonth], ['working_hours_per_day', e.workingHoursPerDay],
    ['ot_multiplier', e.otMultiplier], ['leader_allowance_sen', e.leaderAllowanceSen], ['efficiency_allowance_sen', e.efficiencyAllowanceSen],
    ['efficiency_threshold_pct', e.efficiencyThresholdPct], ['payment_method', e.paymentMethod],
    // Cash needs no bank, so none is kept that a payment file could pick up by mistake.
    ['bank_name', e.paymentMethod === 'cash' ? null : e.bankName], ['bank_account', e.paymentMethod === 'cash' ? null : e.bankAccount],
    ['epf_enabled', e.epfEnabled ? 1 : 0], ['socso_enabled', e.socsoEnabled ? 1 : 0], ['eis_enabled', e.eisEnabled ? 1 : 0], ['pcb_enabled', e.pcbEnabled ? 1 : 0],
    ['tax_residency', e.taxResidency], ['tax_category', e.taxCategory], ['tax_child_relief_sen', e.taxChildReliefSen],
    ['annual_leave_days', e.annualLeaveDays], ['medical_leave_days', e.medicalLeaveDays],
  ];
}

/** Kept out of the audit trail's before/after: the trail shows that they changed, not what they are. */
const PRIVATE: (keyof EmployeeInput)[] = ['bankAccount'];

/** The record as the audit trail keeps it: private numbers become "set" or "not set". */
export function employeeForAudit(e: { name: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { name: e.name };
  for (const [k, v] of Object.entries(e)) {
    if (k === 'name' || k === 'phone' || k === 'isActive' || k === 'employeeId') continue;
    out[k] = PRIVATE.some(p => p === k) ? (v ? 'set' : 'not set') : v;
  }
  return out;
}

/**
 * A new basic salary takes effect from the date the form gives (the start of this month by default); payroll pays each
 * month on the salary in force on its last day (migration 0168). `before` is null when the person had no HR record yet.
 */
export async function recordSalaryChange(env: Env, { employeeId, before, after, askedFrom, userId }: {
  employeeId: string; before: Pick<EmployeeInput, 'basicSalarySen'> | null; after: Pick<EmployeeInput, 'payBasis' | 'basicSalarySen'>;
  askedFrom: unknown; userId: string;
}): Promise<void> {
  if (after.payBasis === 'monthly' && after.basicSalarySen > 0 && (!before || before.basicSalarySen !== after.basicSalarySen) && await hasPayroll(env)) {
    const from = typeof askedFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(askedFrom) ? askedFrom : `${mytToday().slice(0, 7)}-01`;
    await run(env, `
      INSERT INTO employee_salary_history (id, employee_id, basic_salary_sen, effective_from, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (employee_id, effective_from) DO UPDATE SET basic_salary_sen = excluded.basic_salary_sen, created_by = excluded.created_by, created_at = excluded.created_at`,
      crypto.randomUUID(), employeeId, after.basicSalarySen, from, before ? `Was ${before.basicSalarySen} sen` : 'First salary', userId, nowIso());
  }
}

export const isTestEmployee = ({ status }: Pick<Employee, 'status'>): boolean => status === 'test';

export const notTestCleaner = (cleaner: string): string => `NOT EXISTS (SELECT 1 FROM employees te WHERE te.status = 'test'
  AND (te.cleaner_id = ${cleaner}.id OR te.technician_id IN (SELECT tt.id FROM technicians tt WHERE tt.user_id = ${cleaner}.user_id)))`;

export const notTestTechnician = (technician: string): string => `NOT EXISTS (SELECT 1 FROM employees te WHERE te.status = 'test'
  AND (te.technician_id = ${technician}.id OR te.cleaner_id IN (SELECT tc.id FROM cleaners tc WHERE tc.user_id = ${technician}.user_id)))`;

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

/** Someone in a form: by HR record, or by roster entry before they have one. */
export interface PersonRef { employeeId?: string | null; cleanerId?: string | null; technicianId?: string | null }

/**
 * The HR record id of each person given, making the missing records in one statement (Working Hours, Worker Penalty
 * name people by roster entry before anyone saved an HR record). Throws for anyone who is not an in-house person.
 */
export async function employeeIdsFor(env: Env, refs: PersonRef[]): Promise<string[]> {
  const unnamed = refs.filter(r => !r.employeeId);
  const byRoster = new Map<string, string>();
  if (unnamed.length) {
    const now = nowIso();
    const fresh = [...new Map(unnamed.map(r => [`${r.cleanerId ?? ''}|${r.technicianId ?? ''}`, { id: crypto.randomUUID(), cleaner_id: r.cleanerId ?? null, technician_id: r.technicianId ?? null }])).values()];
    await run(env, `
      INSERT INTO employees (id, cleaner_id, technician_id, created_at, updated_at)
      SELECT r.id, r.cleaner_id, r.technician_id, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS r(id text, cleaner_id text, technician_id text)
      ON CONFLICT DO NOTHING`, now, now, JSON.stringify(fresh));
    for (const p of await listEmployees(env)) {
      if (!p.id) continue;
      if (p.cleanerId) byRoster.set(`c:${p.cleanerId}`, p.id);
      if (p.technicianId) byRoster.set(`t:${p.technicianId}`, p.id);
    }
  }
  return refs.map(r => {
    const id = r.employeeId ?? (r.cleanerId && byRoster.get(`c:${r.cleanerId}`)) ?? (r.technicianId && byRoster.get(`t:${r.technicianId}`)) ?? null;
    if (!id) throw new Error('That person is not an in-house cleaner or technician.');
    return id;
  });
}
