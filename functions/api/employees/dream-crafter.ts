import { mayWork } from '../../_lib/access';
import { type Env, all, one, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { employeeRecordColumns, employeeForAudit, recordSalaryChange, toEmployeeRecord, type EmployeeRecordRow } from '../../_lib/hr';
import { followWorker } from '../../_lib/fieldAccess';
import { dcPeopleSql, hasDcAppAccess, hasDcStaff } from '../../_lib/dcStaff';
import { dcEmployeeInput, type DcEmployee } from '../../_lib/hrFields';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const NOT_MIGRATED = 'Dream Crafter employees need a database update (migration 0185) that has not been applied yet.';
const NOT_MIGRATED_APP_ACCESS = 'Switching Dream Crafter staff off needs a database update (migration 0311) that has not been applied yet.';

interface Row extends EmployeeRecordRow { dc_staff_id: string; full_name: string; phone: string | null; login_user_id: string | null; roster_active: number; emp_no: string | null }
const toDc = (r: Row): DcEmployee => ({
  ...toEmployeeRecord(r), id: r.dc_staff_id, name: r.full_name, phone: r.phone, status: r.status === 'resigned' ? 'resigned' : 'active',
  employeeId: r.emp_no, isActive: !!r.roster_active,
});
const findDc = async (env: Env, id: string): Promise<{ person: DcEmployee; userId: string | null } | null> => {
  const row = await one<Row>(env, `${dcPeopleSql(await hasDcAppAccess(env))} WHERE d.id = ?`, id);
  return row ? { person: toDc(row), userId: row.login_user_id } : null;
};

/** GET /api/employees/dream-crafter — Dream Crafter's own staff with their HR record (Dream Crafter > HR > Employees).
 *  hasAppAccess says whether app access and switching off are set up (migration 0311); the screen shows their buttons only then. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Employee records are kept by the office.', 403);
  if (!(await hasDcStaff(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const rows = await all<Row>(env, `${dcPeopleSql(await hasDcAppAccess(env))} ORDER BY (e.status = 'active') DESC, d.full_name`);
  return json({ data: rows.map(toDc), hasAppAccess: await hasDcAppAccess(env) });
};

/**
 * PUT /api/employees/dream-crafter { id?, ...DcEmployeeInput } — add a Dream Crafter employee (no id) or save one.
 * Name and phone go on the roster entry, the rest on the HR record; each write is one statement, so neither half is
 * left behind. isActive switches them off or on: their app login follows at once.
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
  const { name, phone, isActive, ...record } = parsed.data;
  const cols = employeeRecordColumns(record);
  const now = nowIso();
  const askedId = typeof b?.id === 'string' ? b.id : null;
  const found = askedId ? await findDc(env, askedId) : null;
  const before = found?.person ?? null;
  if (askedId && !before) return fail('NOT_FOUND', 'That person is not a Dream Crafter employee.', 404);

  const id = before?.id ?? crypto.randomUUID();
  const hasAppAccess = await hasDcAppAccess(env);
  if (isActive === false && !hasAppAccess) return fail('NOT_MIGRATED', NOT_MIGRATED_APP_ACCESS, 503);
  const shouldSaveActive = isActive !== undefined && hasAppAccess;
  const after = await transaction(env, async tx => {
    const savedRecord = before
      ? await one<{ id: string }>(tx, `
        WITH s AS (UPDATE dc_staff SET full_name = ?, phone = ?, ${shouldSaveActive ? 'is_active = ?, ' : ''}updated_at = ? WHERE id = ? RETURNING id)
        UPDATE employees SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE dc_staff_id = (SELECT id FROM s) RETURNING id`,
        name, phone, ...(shouldSaveActive ? [isActive ? 1 : 0] : []), now, id, ...cols.map(([, v]) => v), now)
      : await one<{ id: string }>(tx, `
        WITH s AS (INSERT INTO dc_staff (id, full_name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id)
        INSERT INTO employees (id, dc_staff_id, ${cols.map(([c]) => c).join(', ')}, created_at, updated_at)
        SELECT ?, s.id, ${cols.map(() => '?').join(', ')}, ?, ? FROM s RETURNING id`,
        id, name, phone, now, now, crypto.randomUUID(), ...cols.map(([, v]) => v), now, now);
    if (!savedRecord) throw new Error(`Saving Dream Crafter employee ${id} wrote no HR record.`);

    await recordSalaryChange(tx, { employeeId: savedRecord.id, before, after: record, askedFrom: b?.salaryEffectiveFrom, userId: session.userId });

    const hasLoginChanged = shouldSaveActive && await followWorker(tx, found?.userId ?? null, !!isActive);
    const saved = (await findDc(tx, id))?.person ?? null;
    await audit(tx, {
      actorId: session.userId, actorLabel: session.fullName, action: before ? 'hr.dc_employee_update' : 'hr.dc_employee_create',
      entityTable: 'dc_staff', entityId: id,
      before: before ? { ...employeeForAudit(before), isActive: before.isActive } : undefined,
      after: saved ? { ...employeeForAudit(saved), isActive: saved.isActive, ...(hasLoginChanged ? { appLogin: isActive ? 'on' : 'off' } : {}) } : undefined,
    });
    return saved;
  });
  return json({ data: after });
};
