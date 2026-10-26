import { mayWork } from '../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees, findEmployee } from '../../_lib/hr';
import { employeeInput, type Employee, type EmployeeInput } from '../../_lib/hrFields';
import { hasPayroll } from '../../_lib/payroll';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const NOT_MIGRATED = 'The employee record needs a database update (migration 0162) that has not been applied yet.';
/** Kept out of the audit trail's before/after: the trail shows that they changed, not what they are. */
const PRIVATE: (keyof EmployeeInput)[] = ['icNumber', 'passportNumber', 'bankAccount'];

/** GET /api/employees — every in-house cleaner and technician with their HR record (HR > Employees, migration 0162). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Employee records are kept by the office.', 403);
  if (!(await hasEmployees(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  return json({ data: await listEmployees(env) });
};

/**
 * PUT /api/employees { cleanerId | technicianId, ...EmployeeInput } — save one person's HR record, the whole record.
 * The first save makes the row; a person on both rosters gets one row holding both ids.
 */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include changing employee records.', 403);
  if (!(await hasEmployees(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const parsed = employeeInput.safeParse(b);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message]));
    return fail('VALIDATION', 'Some fields need a fix.', 422, fields);
  }
  const by = { cleanerId: typeof b?.cleanerId === 'string' ? b.cleanerId : null, technicianId: typeof b?.technicianId === 'string' ? b.technicianId : null };
  const before = await findEmployee(env, by);
  if (!before) return fail('NOT_FOUND', 'That person is not an in-house cleaner or technician.', 404);

  const e = parsed.data;
  // Resigned people keep their record; an active one has no last day.
  const resignedAt = e.status === 'resigned' ? e.resignedAt : null;
  const cols: [string, unknown][] = [
    ['ic_number', e.icNumber], ['passport_number', e.passportNumber], ['nationality', e.nationality], ['join_date', e.joinDate],
    ['status', e.status], ['resigned_at', resignedAt], ['pay_basis', e.payBasis], ['basic_salary_sen', e.basicSalarySen],
    ['daily_rate_sen', e.dailyRateSen], ['working_days_per_month', e.workingDaysPerMonth], ['working_hours_per_day', e.workingHoursPerDay],
    ['ot_multiplier', e.otMultiplier], ['payment_method', e.paymentMethod],
    // Cash needs no bank, so none is kept that a payment file could pick up by mistake.
    ['bank_name', e.paymentMethod === 'cash' ? null : e.bankName], ['bank_account', e.paymentMethod === 'cash' ? null : e.bankAccount],
    ['epf_enabled', e.epfEnabled ? 1 : 0], ['socso_enabled', e.socsoEnabled ? 1 : 0], ['eis_enabled', e.eisEnabled ? 1 : 0], ['pcb_enabled', e.pcbEnabled ? 1 : 0],
    ['tax_residency', e.taxResidency], ['tax_category', e.taxCategory], ['tax_child_relief_sen', e.taxChildReliefSen],
    ['annual_leave_days', e.annualLeaveDays], ['medical_leave_days', e.medicalLeaveDays],
  ];
  const now = nowIso();
  let id = before.id;
  if (id) {
    // Attach the other roster id if this person has since appeared on both lists and no other record holds it.
    const other = before.cleanerId && !(await one(env, 'SELECT 1 AS x FROM employees WHERE cleaner_id = ? AND id <> ?', before.cleanerId, id)) ? before.cleanerId : null;
    const otherTech = before.technicianId && !(await one(env, 'SELECT 1 AS x FROM employees WHERE technician_id = ? AND id <> ?', before.technicianId, id)) ? before.technicianId : null;
    await run(env, `UPDATE employees SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, cleaner_id = COALESCE(cleaner_id, ?), technician_id = COALESCE(technician_id, ?), updated_at = ? WHERE id = ?`,
      ...cols.map(([, v]) => v), other, otherTech, now, id);
  } else {
    id = crypto.randomUUID();
    await run(env, `INSERT INTO employees (id, cleaner_id, technician_id, ${cols.map(([c]) => c).join(', ')}, created_at, updated_at)
      VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
      id, before.cleanerId, before.technicianId, ...cols.map(([, v]) => v), now, now);
  }

  // A new basic salary takes effect from the date the form gives (the start of this month by default); payroll pays each
  // month on the salary in force on its last day (migration 0165).
  if (e.payBasis === 'monthly' && e.basicSalarySen > 0 && (!before.id || before.basicSalarySen !== e.basicSalarySen) && await hasPayroll(env)) {
    const asked = b?.salaryEffectiveFrom;
    const from = typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : `${mytToday().slice(0, 7)}-01`;
    await run(env, `
      INSERT INTO employee_salary_history (id, employee_id, basic_salary_sen, effective_from, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (employee_id, effective_from) DO UPDATE SET basic_salary_sen = excluded.basic_salary_sen, created_by = excluded.created_by, created_at = excluded.created_at`,
      crypto.randomUUID(), id, e.basicSalarySen, from, before.id ? `Was ${before.basicSalarySen} sen` : 'First salary', session.userId, now);
  }

  const after = await findEmployee(env, by);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: before.id ? 'hr.employee_update' : 'hr.employee_create',
    entityTable: 'employees', entityId: id, before: before.id ? forAudit(before) : undefined, after: after ? forAudit(after) : undefined,
  });
  return json({ data: after });
};

/** The record as the audit trail keeps it: private numbers become "set" or "not set". */
function forAudit(e: Employee): Record<string, unknown> {
  const out: Record<string, unknown> = { name: e.name };
  for (const [k, v] of Object.entries(e)) {
    if (k === 'name' || k === 'phone' || k === 'isActive' || k === 'employeeId') continue;
    out[k] = PRIVATE.some(p => p === k) ? (v ? 'set' : 'not set') : v;
  }
  return out;
}
