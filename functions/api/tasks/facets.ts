import { type Env, all, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { SHEET_CLEANER } from '../../_lib/ops';
import { taskCleanersReady } from '../../_lib/taskCleaners';

/** GET /api/tasks/facets — the choices for the work list's building and assignee filters. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return json({ buildings: [], assignees: [] });

  const buildings = await all<{ id: string; name: string }>(env, `SELECT id, name FROM properties ORDER BY name`);
  const ready = await taskCleanersReady(env);
  // Every cleaner on a job (task_cleaners, migration 0122) is a choice with that job counted, not only the first one;
  // a job with nobody listed there falls back to its old single cleaner.
  const listed = ready ? `
      UNION ALL
      SELECT tc.task_id, CASE WHEN tc.cleaner_id IS NOT NULL THEN 'c:' || tc.cleaner_id ELSE 'u:' || tc.user_id END,
             COALESCE(c2.full_name, u2.full_name)
      FROM task_cleaners tc LEFT JOIN cleaners c2 ON c2.id = tc.cleaner_id LEFT JOIN users u2 ON u2.id = tc.user_id` : '';
  const assignees = await all<{ key: string; name: string; n: number }>(env, `
    SELECT key, MAX(name) AS name, COUNT(DISTINCT task_id)::int AS n FROM (
      SELECT t.id AS task_id, CASE WHEN t.cleaner_id IS NOT NULL THEN 'c:' || t.cleaner_id
                  WHEN t.assignee_id IS NOT NULL THEN 'u:' || t.assignee_id
                  ELSE 's:' || ${SHEET_CLEANER('t')} END AS key,
             COALESCE(cl.full_name, a.full_name, ${SHEET_CLEANER('t')}) AS name
      FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
      ${ready ? 'WHERE NOT EXISTS (SELECT 1 FROM task_cleaners x WHERE x.task_id = t.id)' : ''}${listed}
    ) x WHERE key IS NOT NULL GROUP BY key ORDER BY n DESC, name`);
  return json({
    buildings,
    assignees: assignees.map(a => ({ key: a.key, name: a.key.startsWith('s:') ? `${a.name} (from sheet)` : a.name, count: Number(a.n) })),
  });
};
