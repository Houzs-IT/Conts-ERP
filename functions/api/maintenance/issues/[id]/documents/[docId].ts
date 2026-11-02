import { type Env, one, run, json, fail, audit } from '../../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../../_lib/auth';
import { isAssignee } from '../../../../../_lib/maintenance';

/** DELETE /api/maintenance/issues/:id/documents/:docId — take back a claim, invoice, receipt or proof file added by
 *  mistake. Photos and videos go through ../photos/[docId].ts. A purchase is refused: it was also handed in as a receipt
 *  in the finance system, which must be cancelled there. Field roles: on a job they are on or reported, only what they
 *  added, and not once the job is closed. The office can remove any. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const issue = await one<{ reported_by: string | null; state: string }>(env, 'SELECT reported_by, state FROM maintenance_issues WHERE id = ?', id);
  if (!issue) return fail('NOT_FOUND', 'That job no longer exists. Refresh the list.', 404);
  const field = isFieldRole(session.role);
  if (field && issue.reported_by !== session.userId && !(await isAssignee(env, id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (field && issue.state === 'resolved') return fail('CONFLICT', 'That job is closed. Ask the office to reopen it.', 409);

  const d = await one<{ id: string; kind: string; file_name: string; storage_key: string; uploaded_by: string | null }>(env,
    "SELECT id, kind, file_name, storage_key, uploaded_by FROM documents WHERE id = ? AND maintenance_id = ? AND kind NOT IN ('photo','video')", String(params.docId), id);
  if (!d) return fail('NOT_FOUND', 'That file is already gone. Refresh the job.', 404);
  if (d.kind === 'purchase') return fail('CONFLICT', 'This receipt was handed in to finance. Ask finance to cancel it there.', 409);
  if (field && d.uploaded_by !== session.userId) return fail('FORBIDDEN', 'Only the person who added this file can remove it.', 403);

  await run(env, 'DELETE FROM documents WHERE id = ?', d.id);
  // The row is gone first, so a failed storage delete leaves an unseen file, never a broken link.
  try { await env.MEDIA?.delete(d.storage_key); } catch (e) { console.error('maintenance file storage delete failed', d.storage_key, e); }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.document_remove', entityTable: 'maintenance_issues', entityId: id, before: { documentId: d.id, kind: d.kind, fileName: d.file_name }, source: field ? 'field_app' : 'web' });
  return json({ ok: true });
};
