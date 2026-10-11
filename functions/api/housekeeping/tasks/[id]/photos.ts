import { type Env, all, one, json, fail } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { onTask } from '../../../../_lib/ops';

/** GET /api/housekeeping/tasks/:id/photos — the proof-of-delivery gallery for one
 *  clean. Lists the photos and videos uploaded through POST /api/tasks/:id/photos (R2, binding
 *  MEDIA), newest first, each with a /api/documents/:id/download URL to render.
 *  Upload stays on the shared tasks endpoint; this is the read side the POD gallery
 *  and the completion proof both use. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const t = await one<{ id: string; assignee_id: string | null }>(env, 'SELECT id, assignee_id FROM tasks WHERE id = ?', id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  if (isFieldRole(session.role) && t.assignee_id !== session.userId && !(await onTask(env, t.id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  const rows = await all<{ id: string; kind: string; file_name: string; mime_type: string; byte_size: number; captured_at: string | null; created_at: string; uploader: string | null }>(env, `
    SELECT d.id, d.kind, d.file_name, d.mime_type, d.byte_size, d.captured_at, d.created_at,
           u.full_name AS uploader
    FROM documents d
    LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.task_id = ? AND d.kind IN ('photo','video')
    ORDER BY d.created_at DESC`, id);

  return json({
    data: rows.map(r => ({
      id: r.id, kind: r.kind,
      url: `/api/documents/${r.id}/download`,
      fileName: r.file_name,
      mimeType: r.mime_type,
      byteSize: Number(r.byte_size),
      capturedAt: r.captured_at ?? r.created_at,
      uploader: r.uploader || null,
    })),
  });
};
