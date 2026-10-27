import { type Env, one, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { isOnTask } from '../../../../_lib/taskCleaners';

/** The two types a cleaner picks between: Basic clean (BC, the default) and Deep clean (DC). */
const PICKABLE = ['turnover', 'deep_clean'] as const;
type Pickable = typeof PICKABLE[number];
const isPickable = (v: unknown): v is Pickable => typeof v === 'string' && (PICKABLE as readonly string[]).includes(v);
const TITLE: Record<string, string> = { turnover: 'Basic clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };

/** PATCH /api/field/tasks/:id/kind { kind: 'turnover' | 'deep_clean' }
 *  CS asks for the clean; Basic or Deep is the cleaning team's call (26 Oct 2026), so a cleaner on the job may switch
 *  it until the job is finished. A title that only names the type follows it; a typed title stays. The price follows
 *  the type when the clean is charged (cleaning.ts chargeClean). Cleaners only: /api/field is in no access area, and
 *  the office changes the type through PATCH /housekeeping/tasks/:id, which Operations access guards. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }): Promise<Response> => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!isFieldRole(session.role)) return fail('FORBIDDEN', 'The office changes the cleaning type on the Cleaning board.', 403);
  const id = String(params.id);
  const b: unknown = await request.json().catch(() => null);
  const kind = typeof b === 'object' && b !== null && 'kind' in b ? b.kind : undefined;
  if (!isPickable(kind)) return fail('VALIDATION', 'Pick Basic clean (BC) or Deep clean (DC).', 422, { kind: 'Basic or deep clean.' });

  const t = await one<{ kind: string; state: string; title: string }>(env, `
    SELECT kind, state, title FROM tasks WHERE id = ? AND unit_id IS NOT NULL AND kind IN ('turnover','deep_clean','light_clean')`, id);
  if (!t) return fail('NOT_FOUND', 'That cleaning job no longer exists. Refresh the list.', 404);
  if (!(await isOnTask(env, id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (t.state === 'resolved') return fail('CONFLICT', 'This job is already finished.', 409);
  if (t.kind === kind) return json({ ok: true, kind });

  const title = Object.values(TITLE).includes(t.title) ? TITLE[kind] : t.title;
  const changed = await one(env, `UPDATE tasks SET kind = ?, title = ?, updated_at = ? WHERE id = ? AND state <> 'resolved' RETURNING id`, kind, title, nowIso(), id);
  if (!changed) return fail('CONFLICT', 'This job is already finished.', 409);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.edit', entityTable: 'tasks', entityId: id,
    before: { kind: t.kind, title: t.title }, after: { kind, title }, source: 'field_app',
  });
  return json({ ok: true, kind });
};
