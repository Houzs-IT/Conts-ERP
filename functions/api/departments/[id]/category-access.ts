import { type Env, all, one, json, fail, run, audit, nowIso, transaction } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { choiceOfRows, describeChoice, parseCategoryAccess, rowsOfChoice, type CategoryChoice } from '../../../_lib/categoryCatalog';
import { categoryAccessReady, notMigrated } from '../../../_lib/categoryAccessReady';

interface DepartmentCategoryAccess extends CategoryChoice { departmentId: string; restricted: boolean }

const loadRows = (env: Env, id: string) =>
  all<{ group_code: string; sub_code: string | null }>(env,
    'SELECT group_code, sub_code FROM department_category_access WHERE department_id = ? ORDER BY group_code, sub_code', id);

/** GET /api/departments/:id/category-access -> which product categories everyone in this department is limited to
 *  (unless a person has their own setting). `restricted` false means no limit (no rows). Management only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can see category access.', 403);
  if (!(await categoryAccessReady(env))) return notMigrated();

  const id = String(params.id);
  if (!await one(env, 'SELECT id FROM departments WHERE id = ?', id)) return fail('NOT_FOUND', 'That department no longer exists.', 404);
  const rows = await loadRows(env, id);
  const body: DepartmentCategoryAccess = { departmentId: id, restricted: rows.length > 0, ...choiceOfRows(rows) };
  return json(body);
};

/** PUT /api/departments/:id/category-access { restricted, groups, subs, other }. Management only. Replaces this
 *  department's rows in one transaction. `restricted: false` deletes them. A limited save needs at least one tick, and
 *  every code must be in the catalog (functions/_lib/categoryCatalog.ts). */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change category access.', 403);
  if (!(await categoryAccessReady(env))) return notMigrated();

  const id = String(params.id);
  const parsed = parseCategoryAccess(await request.json().catch(() => null));
  if (!parsed.ok) return fail('VALIDATION', parsed.message, 400);
  const { restricted, ...choice } = parsed.value;

  const dept = await one<{ name: string }>(env, 'SELECT name FROM departments WHERE id = ?', id);
  if (!dept) return fail('NOT_FOUND', 'That department no longer exists.', 404);

  const was = await loadRows(env, id);
  const now = nowIso();
  await transaction(env, async tx => {
    await run(tx, 'DELETE FROM department_category_access WHERE department_id = ?', id);
    const rows = restricted ? rowsOfChoice(choice) : [];
    if (rows.length > 0) {
      await run(tx,
        `INSERT INTO department_category_access (department_id, group_code, sub_code, updated_by, updated_at) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        ...rows.flatMap(({ group, sub }) => [id, group, sub, session.userId, now]));
    }
    await audit(tx, {
      actorId: session.userId, actorLabel: session.fullName, action: 'department.category_access_change', entityTable: 'departments', entityId: id,
      before: { department: dept.name, categories: describeChoice(was.length > 0, choiceOfRows(was)) },
      after: { department: dept.name, categories: describeChoice(restricted, choice) },
    });
  });

  const body: DepartmentCategoryAccess = { departmentId: id, restricted, ...choice };
  return json(body);
};
