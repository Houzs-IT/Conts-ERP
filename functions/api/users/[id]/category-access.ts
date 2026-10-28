import { type Env, all, one, json, fail, run, audit, nowIso, transaction } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { choiceOfRows, describeChoice, parseCategoryAccess, rowsOfChoice, type CategoryChoice } from '../../../_lib/categoryCatalog';

interface PersonCategoryAccess extends CategoryChoice { userId: string; restricted: boolean }

const loadRows = (env: Env, id: string) =>
  all<{ group_code: string; sub_code: string | null }>(env,
    'SELECT group_code, sub_code FROM person_category_access WHERE user_id = ? ORDER BY group_code, sub_code', id);

/** GET /api/users/:id/category-access -> which product categories this person is limited to. `restricted` false means
 *  they see everything (no rows). `subs` holds "GROUP/SUB" codes. Management only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can see category access.', 403);

  const id = String(params.id);
  if (!await one(env, 'SELECT id FROM users WHERE id = ?', id)) return fail('NOT_FOUND', 'That account no longer exists.', 404);
  const rows = await loadRows(env, id);
  const body: PersonCategoryAccess = { userId: id, restricted: rows.length > 0, ...choiceOfRows(rows) };
  return json(body);
};

/** PUT /api/users/:id/category-access { restricted, groups, subs, other }. Management only. Replaces this person's rows
 *  in one transaction. `restricted: false` deletes them (the person sees everything). A limited save needs at least one
 *  tick, and every code must be in the catalog (functions/_lib/categoryCatalog.ts). */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change category access.', 403);

  const id = String(params.id);
  const parsed = parseCategoryAccess(await request.json().catch(() => null));
  if (!parsed.ok) return fail('VALIDATION', parsed.message, 400);
  const { restricted, ...choice } = parsed.value;

  const user = await one<{ full_name: string }>(env, 'SELECT full_name FROM users WHERE id = ?', id);
  if (!user) return fail('NOT_FOUND', 'That account no longer exists.', 404);

  const was = await loadRows(env, id);
  const now = nowIso();
  await transaction(env, async tx => {
    await run(tx, 'DELETE FROM person_category_access WHERE user_id = ?', id);
    const rows = restricted ? rowsOfChoice(choice) : [];
    if (rows.length > 0) {
      await run(tx,
        `INSERT INTO person_category_access (user_id, group_code, sub_code, updated_by, updated_at) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        ...rows.flatMap(({ group, sub }) => [id, group, sub, session.userId, now]));
    }
    await audit(tx, {
      actorId: session.userId, actorLabel: session.fullName, action: 'user.category_access_change', entityTable: 'users', entityId: id,
      before: { user: user.full_name, categories: describeChoice(was.length > 0, choiceOfRows(was)) },
      after: { user: user.full_name, categories: describeChoice(restricted, choice) },
    });
  });

  const body: PersonCategoryAccess = { userId: id, restricted, ...choice };
  return json(body);
};
