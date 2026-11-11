import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { isAssignee, hasSupportRequest } from '../../../../_lib/maintenance';
import { repairNotice } from '../../../../_lib/notices';

interface PassKeyJob { id: string; state: string; job_type: string | null }

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const isField = isFieldRole(session.role);

  const id = String(params.id);
  const body = await request.json<{ note?: unknown }>().catch(() => null);
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
  const job = await one<PassKeyJob>(env, 'SELECT id, state, job_type FROM maintenance_issues WHERE id = ?', id);
  if (!job) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (job.job_type !== 'pass_key') return fail('CONFLICT', 'Only a Pass key job can be marked Pass key done.', 409);
  if (isField && !(await isAssignee(env, id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (job.state === 'resolved') return fail('CONFLICT', 'That Pass key job is already done.', 409);
  const photos = await one<{ count: number }>(env, `SELECT COUNT(*)::int AS count FROM documents WHERE maintenance_id = ? AND kind IN ('photo','video')`, id);
  if (!Number(photos?.count)) return fail('VALIDATION', 'Add a photo first.', 422, { photos: 'Add a photo first.' });

  const doneAt = nowIso();
  const clearSupport = (await hasSupportRequest(env)) ? ', support_requested_at = NULL, support_note = NULL' : '';
  await run(env, `
    UPDATE maintenance_issues SET state = 'resolved', started_at = COALESCE(started_at, ?), ended_at = COALESCE(ended_at, ?),
      resolved_at = ?, final_amount = 0, blocks_unit = 0, updated_at = ?${clearSupport}
    WHERE id = ?`, doneAt, doneAt, doneAt, doneAt, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.pass_key_done', entityTable: 'maintenance_issues', entityId: id, before: { state: job.state }, after: { state: 'resolved', note }, source: isField ? 'field_app' : 'web' });
  await repairNotice(env, id, 'done', session.userId);
  return json({ ok: true, doneAt });
};
