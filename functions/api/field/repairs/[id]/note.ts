import { type Env, one, json, fail, audit } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { isAssignee } from '../../../../_lib/maintenance';

/** POST /api/field/repairs/:id/note { note } — a line from the technician on the job ("part ordered, back Thursday").
 *  Kept in the job's History (audit_log), which is where the office reads it: there is no notes column. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const note = typeof b?.note === 'string' ? b.note.trim().slice(0, 1000) : '';
  if (!note) return fail('VALIDATION', 'Write the note first.', 422, { note: 'Write the note first.' });
  if (!(await one(env, 'SELECT 1 AS x FROM maintenance_issues WHERE id = ?', id))) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const field = isFieldRole(session.role);
  if (field && !(await isAssignee(env, id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.note', entityTable: 'maintenance_issues', entityId: id, after: { note }, source: field ? 'field_app' : 'web' });
  return json({ ok: true }, 201);
};
