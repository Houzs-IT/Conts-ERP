import { type Env, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { TABLE_KEY, WORKING_NAME, cleanColumns, mayUseViews } from '../../_lib/tableLayouts';

/** PUT /api/table-layouts/columns { table, columns } — the signed-in person's own column order and hidden columns for
 *  one list (a header dragged, or the Columns menu), kept with their account so the list opens the same way on any
 *  computer (chew, 13 Nov 2026: "这个header 可以拖动自己排吗？根据user"). One row per person and list, under a reserved
 *  name that the views list leaves out (index.ts). Answers when it was kept: a list takes the account's order only when
 *  it is newer than the one it already has (src/lib/columnOrder.ts accountOrderNewer). */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseViews(session.role)) return fail('FORBIDDEN', 'Saved views are not available on this account.', 403);
  const b = await request.json<any>().catch(() => null);
  const table = String(b?.table ?? '');
  if (!TABLE_KEY.test(table)) return fail('VALIDATION', 'Say which table.', 422);
  const columns = cleanColumns(b?.columns);
  if (typeof columns === 'string') return fail('VALIDATION', columns, 422);
  if (!columns.length) return fail('VALIDATION', 'Say which columns.', 422);

  const now = nowIso();
  // One statement, so two saves sent at once (two tabs) leave one row: the unique name index of migration 0094.
  const row = await one<{ updated_at: string }>(env, `INSERT INTO table_layouts (id, table_key, user_id, name, is_default, layout, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, false, ?::text::jsonb, ?, ?, ?)
    ON CONFLICT (table_key, (COALESCE(user_id, '')), (lower(btrim(name)))) DO UPDATE SET layout = EXCLUDED.layout, updated_at = EXCLUDED.updated_at
    RETURNING updated_at`,
    crypto.randomUUID(), table, session.userId, WORKING_NAME, JSON.stringify({ columns, sort: null, pageSize: null, filters: {} }),
    session.userId, now, now);
  return json({ ok: true, at: row?.updated_at ?? now });
};
