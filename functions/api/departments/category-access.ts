import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { catalogTree, choiceOfRows, type CategoryChoice } from '../../_lib/categoryCatalog';
import { categoryAccessReady, notMigrated } from '../../_lib/categoryAccessReady';

interface LimitedDepartment extends CategoryChoice { departmentId: string }

/** GET /api/departments/category-access -> the product category catalog and every department that is limited to some
 *  of it. A department with no rows has no limit and is not listed. Management only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can see category access.', 403);
  if (!(await categoryAccessReady(env))) return notMigrated();

  const rows = await all<{ department_id: string; group_code: string; sub_code: string | null }>(env,
    'SELECT department_id, group_code, sub_code FROM department_category_access ORDER BY department_id, group_code, sub_code');
  const byDept = new Map<string, { group_code: string; sub_code: string | null }[]>();
  for (const { department_id, ...row } of rows) byDept.set(department_id, [...(byDept.get(department_id) ?? []), row]);
  const limited: LimitedDepartment[] = [...byDept].map(([departmentId, list]) => ({ departmentId, ...choiceOfRows(list) }));
  return json({ catalog: catalogTree(), limited });
};
