import { mayWork } from '../../_lib/access';
import { type Env, all, one, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole, hasColumn } from '../../_lib/auth';
import { employeeRecordColumns, employeeForAudit, recordSalaryChange, toEmployeeRecord, type EmployeeRecordRow } from '../../_lib/hr';
import { dcEmployeeInput, type DcEmployee } from '../../_lib/hrFields';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const NOT_MIGRATED = 'Dream Crafter employees need a database update (migration 0185) that has not been applied yet.';
const hasDcStaff = (env: Env): Promise<boolean> => hasColumn(env, 'employees', 'dc_staff_id').catch(() => false);

interface Row extends EmployeeRecordRow { dc_staff_id: string; full_name: string; phone: string | null }
const PEOPLE = 'SELECT d.full_name, d.phone, e.* FROM dc_staff d JOIN employees e ON e.dc_staff_id = d.id';
const toDc = (r: Row): DcEmployee => ({
  ...toEmployeeRecord(r), id: r.dc_staff_id, name: r.full_name, phone: r.phone, status: r.status === 'resigned' ? 'resigned' : 'active',
});
const findDc = async (env: Env, id: string): Promise<DcEmployee | null> => {
  const row = await one<Row>(env, `${PEOPLE} WHERE d.id = ?`, id);
  return row ? toDc(row) : null;
};

/** GET /api/employees/dream-crafter — Dream Crafter's own staff with their HR record (Dream Crafter > HR > Employees). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Employee records are kept by the office.', 403);
  if (!(await hasDcStaff(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const rows = await all<Row>(env, `${PEOPLE} ORDER BY (e.status = 'active') DESC, d.full_name`);
  return json({ data: rows.map(toDc) });
};

/**
 * PUT /api/employees/dream-crafter { id?, ...DcEmployeeInput } — add a Dream Crafter employee (no id) or save one.
 * Name and phone go on the roster entry, the rest on the HR record; each write is one statement, so neither half is
 * left behind.
 */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include changing employee records.', 403);
  if (!(await hasDcStaff(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const parsed = dcEmployeeInput.safeParse(b);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message]));
    return fail('VALIDATION', 'Some fields need a fix.', 422, fields);
  }
  const { name, phone, ...record } = parsed.data;
  const cols = employeeRecordColumns(record);
  const now = nowIso();
  const askedId = typeof b?.id === 'string' ? b.id : null;
  const before = askedId ? await findDc(env, askedId) : null;
  if (askedId && !before) return fail('NOT_FOUND', 'That person is not a Dream Crafter employee.', 404);

  const id = before?.id ?? crypto.randomUUID();
  const savedRecord = before
    ? await one<{ id: string }>(env, `
      WITH s AS (UPDATE dc_staff SET full_name = ?, phone = ?, updated_at = ? WHERE id = ? RETURNING id)
      UPDATE employees SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE dc_staff_id = (SELECT id FROM s) RETURNING id`,
      name, phone, now, id, ...cols.map(([, v]) => v), now)
    : await one<{ id: string }>(env, `
      WITH s AS (INSERT INTO dc_staff (id, full_name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id)
      INSERT INTO employees (id, dc_staff_id, ${cols.map(([c]) => c).join(', ')}, created_at, updated_at)
      SELECT ?, s.id, ${cols.map(() => '?').join(', ')}, ?, ? FROM s RETURNING id`,
      id, name, phone, now, now, crypto.randomUUID(), ...cols.map(([, v]) => v), now, now);
  if (!savedRecord) throw new Error(`Saving Dream Crafter employee ${id} wrote no HR record.`);

  await recordSalaryChange(env, { employeeId: savedRecord.id, before, after: record, askedFrom: b?.salaryEffectiveFrom, userId: session.userId });

  const after = await findDc(env, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: before ? 'hr.dc_employee_update' : 'hr.dc_employee_create',
    entityTable: 'dc_staff', entityId: id, before: before ? employeeForAudit(before) : undefined, after: after ? employeeForAudit(after) : undefined,
  });
  return json({ data: after });
};
