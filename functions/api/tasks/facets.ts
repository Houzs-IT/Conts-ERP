import { type Env, all, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { SHEET_CLEANER } from '../../_lib/ops';

/** GET /api/tasks/facets — the choices for the work list's building and assignee filters. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return json({ buildings: [], assignees: [] });

  const buildings = await all<{ id: string; name: string }>(env, `SELECT id, name FROM properties ORDER BY name`);
  const assignees = await all<{ key: string; name: string; n: number }>(env, `
    SELECT key, name, COUNT(*)::int AS n FROM (
      SELECT CASE WHEN t.cleaner_id IS NOT NULL THEN 'c:' || t.cleaner_id
                  WHEN t.assignee_id IS NOT NULL THEN 'u:' || t.assignee_id
                  ELSE 's:' || ${SHEET_CLEANER('t')} END AS key,
             COALESCE(cl.full_name, a.full_name, ${SHEET_CLEANER('t')}) AS name
      FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
    ) x WHERE key IS NOT NULL GROUP BY key, name ORDER BY n DESC, name`);
  return json({
    buildings,
    assignees: assignees.map(a => ({ key: a.key, name: a.key.startsWith('s:') ? `${a.name} (from sheet)` : a.name, count: Number(a.n) })),
  });
};
