import { type Env, one, run, json, fail, audit } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';

/** DELETE /api/tasks/:id/photos/:docId — take back a proof-of-work photo or video before the job is complete.
 *  A finished job's proof is locked. A field account removes only what it uploaded itself, on its own job. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const t = await one<{ state: string; assignee_id: string | null }>(env, 'SELECT state, assignee_id FROM tasks WHERE id = ?', id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  const field = isFieldRole(session.role);
  if (field && t.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (t.state === 'resolved') return fail('CONFLICT', 'This job is complete, so its proof of work can no longer change.', 409);

  const d = await one<{ id: string; kind: string; file_name: string; storage_key: string; uploaded_by: string | null }>(env,
    "SELECT id, kind, file_name, storage_key, uploaded_by FROM documents WHERE id = ? AND task_id = ? AND kind IN ('photo','video')", String(params.docId), id);
  if (!d) return fail('NOT_FOUND', 'That photo is already gone. Refresh the job.', 404);
  if (field && d.uploaded_by !== session.userId) return fail('FORBIDDEN', 'Only the person who added this photo can remove it.', 403);

  await run(env, 'DELETE FROM documents WHERE id = ?', d.id);
  // The row is gone first, so a failed storage delete leaves an unseen file, never a broken thumbnail.
  try { await env.MEDIA?.delete(d.storage_key); } catch (e) { console.error('task photo storage delete failed', d.storage_key, e); }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.photo_remove', entityTable: 'tasks', entityId: id, before: { documentId: d.id, kind: d.kind, fileName: d.file_name }, source: field ? 'field_app' : 'web' });
  return json({ ok: true });
};
