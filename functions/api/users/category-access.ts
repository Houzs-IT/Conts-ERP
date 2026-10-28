import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { catalogTree, choiceOfRows, type CategoryChoice } from '../../_lib/categoryCatalog';

interface LimitedPerson extends CategoryChoice { userId: string }

/** GET /api/users/category-access -> the product category catalog and everyone who is limited to some of it. A person
 *  with no rows sees everything and is not listed. Management only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can see category access.', 403);

  const rows = await all<{ user_id: string; group_code: string; sub_code: string | null }>(env,
    'SELECT user_id, group_code, sub_code FROM person_category_access ORDER BY user_id, group_code, sub_code');
  const byUser = new Map<string, { group_code: string; sub_code: string | null }[]>();
  for (const { user_id, ...row } of rows) byUser.set(user_id, [...(byUser.get(user_id) ?? []), row]);
  const limited: LimitedPerson[] = [...byUser].map(([userId, list]) => ({ userId, ...choiceOfRows(list) }));
  return json({ catalog: catalogTree(), limited });
};
