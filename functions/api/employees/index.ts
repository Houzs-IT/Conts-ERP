import { mayWork } from '../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees, findEmployee, employeeRecordColumns, recordSalaryChange, employeeForAudit } from '../../_lib/hr';
import { employeeInput } from '../../_lib/hrFields';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const NOT_MIGRATED = 'The employee record needs a database update (migration 0165) that has not been applied yet.';

/** GET /api/employees — every in-house cleaner and technician with their HR record (HR > Employees, migration 0165). */
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
  const cols = employeeRecordColumns(e);
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

  await recordSalaryChange(env, { employeeId: id, before: before.id ? before : null, after: e, askedFrom: b?.salaryEffectiveFrom, userId: session.userId });

  const after = await findEmployee(env, by);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: before.id ? 'hr.employee_update' : 'hr.employee_create',
    entityTable: 'employees', entityId: id, before: before.id ? employeeForAudit(before) : undefined, after: after ? employeeForAudit(after) : undefined,
  });
  return json({ data: after });
};
