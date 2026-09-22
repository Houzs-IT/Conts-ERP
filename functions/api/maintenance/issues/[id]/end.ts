import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';

/** POST /api/maintenance/issues/:id/end — records when the repair finished. The job is not
 *  yet resolved: completing it (with the final amount) still raises the expense. This only
 *  stamps the end so the duration can be shown. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot end jobs from here.', 403);

  const id = String(params.id);
  const cur = await one<any>(env, 'SELECT id, state, started_at, ended_at FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (cur.state === 'resolved') return fail('CONFLICT', 'That job is already finished.', 409);
  if (!cur.started_at) return fail('CONFLICT', 'Start the job before ending it.', 409);

  const now = nowIso();
  const endedAt = cur.ended_at ?? now;
  await run(env, `UPDATE maintenance_issues SET ended_at = ?, updated_at = ? WHERE id = ?`, endedAt, now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.end', entityTable: 'maintenance_issues', entityId: id, before: { startedAt: cur.started_at }, after: { endedAt } });
  return json({ ok: true, endedAt });
};
