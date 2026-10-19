import { type Env, one, all, run, nowIso } from './db';
import { hasColumn } from './auth';

/** Several cleaners on one cleaning job (migration 0122, task_cleaners). tasks.cleaner_id / tasks.assignee_id stay the
 *  FIRST cleaner, so code that reads only them keeps working; everything that asks "is this my job" or "who is on it"
 *  goes through here. Before the migration is applied, a job has the one cleaner of the old columns. */
export const taskCleanersReady = (env: Env) => hasColumn(env, 'task_cleaners', 'task_id').catch(() => false);

/** SQL true when the signed-in person is on job `a` (as its first cleaner or any listed one). Bind mineArgs after it. */
export const mineSql = (ready: boolean, a = 't') => (ready
  ? `(${a}.assignee_id = ? OR EXISTS (SELECT 1 FROM task_cleaners tc_m WHERE tc_m.task_id = ${a}.id AND tc_m.user_id = ?))`
  : `${a}.assignee_id = ?`);
export const mineArgs = (ready: boolean, userId: string) => (ready ? [userId, userId] : [userId]);

/** Whether the person is one of the job's cleaners: the field app's "own task" rule. */
export async function isOnTask(env: Env, taskId: string, userId: string): Promise<boolean> {
  const ready = await taskCleanersReady(env);
  const r = await one<{ x: number }>(env, `SELECT 1 AS x FROM tasks t WHERE t.id = ? AND ${mineSql(ready)}`, taskId, ...mineArgs(ready, userId));
  return !!r;
}

/** SQL for job `a`'s cleaner names, in order, comma separated (NULL when it has none listed). */
export const cleanerNamesSql = (ready: boolean, a = 't') => (ready
  ? `(SELECT string_agg(COALESCE(c_n.full_name, u_n.full_name), ', ' ORDER BY tc_n.position, tc_n.assigned_at)
       FROM task_cleaners tc_n LEFT JOIN cleaners c_n ON c_n.id = tc_n.cleaner_id LEFT JOIN users u_n ON u_n.id = tc_n.user_id
      WHERE tc_n.task_id = ${a}.id)`
  : 'NULL');

/** SQL for job `a`'s cleaners as JSON text: [{ cleanerId, userId, name, outsourced }]. */
export const cleanerListSql = (ready: boolean, a = 't') => (ready
  ? `(SELECT json_agg(json_build_object('cleanerId', tc_l.cleaner_id, 'userId', tc_l.user_id, 'name', COALESCE(c_l.full_name, u_l.full_name),
                                        'outsourced', c_l.employment_type = 'outsourced') ORDER BY tc_l.position, tc_l.assigned_at)::text
       FROM task_cleaners tc_l LEFT JOIN cleaners c_l ON c_l.id = tc_l.cleaner_id LEFT JOIN users u_l ON u_l.id = tc_l.user_id
      WHERE tc_l.task_id = ${a}.id)`
  : 'NULL');

/** SQL for job `a`'s roster cleaner in the old columns: cleaner_id, or the roster entry of the login in assignee_id
 *  (jobs assigned by login before the roster existed), so a screen can show and keep that person. */
export const rosterIdSql = (a = 't') => `COALESCE(${a}.cleaner_id, (SELECT rc.id FROM cleaners rc WHERE rc.user_id = ${a}.assignee_id LIMIT 1))`;

export interface TaskCleaner { cleanerId: string | null; userId: string | null; name: string; outsourced: boolean }

/** Parses cleanerListSql's text; when nothing is listed (table missing, or a job only the old columns name),
 *  the old single cleaner stands in so no screen shows a job with a cleaner as unassigned. */
export function parseCleaners(text: string | null | undefined, legacy?: { cleanerId: string | null; userId: string | null; name: string | null }): TaskCleaner[] {
  let list: TaskCleaner[] = [];
  try { list = text ? (JSON.parse(text) as TaskCleaner[]).map(c => ({ ...c, outsourced: !!c.outsourced, name: c.name ?? '' })) : []; } catch { list = []; }
  if (!list.length && legacy?.name && (legacy.cleanerId || legacy.userId)) list = [{ cleanerId: legacy.cleanerId, userId: legacy.userId, name: legacy.name, outsourced: false }];
  return list;
}

/** Writes the job's cleaner list (order = position; the first one is mirrored into tasks.cleaner_id / assignee_id by
 *  the caller). People already on the job keep when and by whom they were added. A no-op before migration 0122. */
export async function writeTaskCleaners(env: Env, taskId: string, people: { cleanerId: string | null; userId: string | null }[], by: string | null) {
  if (!(await taskCleanersReady(env))) return;
  const before = await all<{ cleaner_id: string | null; user_id: string | null; assigned_at: string; assigned_by: string | null }>(env,
    'SELECT cleaner_id, user_id, assigned_at, assigned_by FROM task_cleaners WHERE task_id = ?', taskId);
  const key = (c: string | null, u: string | null) => (c ? `c:${c}` : `u:${u}`);
  const kept = new Map(before.map(r => [key(r.cleaner_id, r.user_id), r]));
  const now = nowIso();
  const seen = new Set<string>();
  const rows = people.filter(p => {
    const k = key(p.cleanerId, p.userId);
    if (seen.has(k) || (!p.cleanerId && !p.userId)) return false;
    seen.add(k); return true;
  }).map((p, position) => {
    const old = kept.get(key(p.cleanerId, p.userId));
    return { id: crypto.randomUUID(), cleaner_id: p.cleanerId, user_id: p.userId, position, assigned_at: old?.assigned_at ?? now, assigned_by: old ? old.assigned_by : by };
  });
  await run(env, 'DELETE FROM task_cleaners WHERE task_id = ?', taskId);
  if (rows.length) {
    await run(env, `
      INSERT INTO task_cleaners (id, task_id, cleaner_id, user_id, position, assigned_at, assigned_by)
      SELECT r.id, ?, r.cleaner_id, r.user_id, r.position, r.assigned_at, r.assigned_by
      FROM jsonb_to_recordset(?::text::jsonb) AS r(id text, cleaner_id text, user_id text, position int, assigned_at text, assigned_by text)`,
      taskId, JSON.stringify(rows));
  }
}

/** The cleaners on a job now: the listed ones, or the old single cleaner. */
export async function currentCleaners(env: Env, taskId: string): Promise<TaskCleaner[]> {
  const ready = await taskCleanersReady(env);
  const r = await one<{ list: string | null; cleaner_id: string | null; assignee_id: string | null; name: string | null }>(env, `
    SELECT ${cleanerListSql(ready)} AS list, ${rosterIdSql()} AS cleaner_id, t.assignee_id, COALESCE(c.full_name, u.full_name) AS name
    FROM tasks t LEFT JOIN cleaners c ON c.id = t.cleaner_id LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?`, taskId);
  if (!r) return [];
  return parseCleaners(r.list, { cleanerId: r.cleaner_id, userId: r.assignee_id, name: r.name });
}
