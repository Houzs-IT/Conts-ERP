import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';

/** GET /api/maintenance/issues/:id/documents — the job's files: before and after photos and videos, the proof of
 *  work and the invoice, oldest first, each with its download address. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot open maintenance files here.', 403);
  const id = String(params.id);
  if (!(await one(env, 'SELECT 1 AS x FROM maintenance_issues WHERE id = ?', id))) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const rows = await all<any>(env, `
    SELECT d.id, d.kind, d.file_name, d.mime_type, d.byte_size, d.created_at, u.full_name AS uploader
    FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.maintenance_id = ? ORDER BY d.created_at`, id);
  return json({
    data: rows.map(r => ({
      id: r.id, kind: r.kind, url: `/api/documents/${r.id}/download`, fileName: r.file_name, mimeType: r.mime_type,
      byteSize: Number(r.byte_size), uploadedAt: r.created_at, uploader: r.uploader ?? null,
      // Photos and videos carry their stage in the file name ("before-...", "after-...").
      stage: r.kind === 'photo' || r.kind === 'video' ? (String(r.file_name).startsWith('after-') ? 'after' : 'before') : null,
    })),
  });
};

const MAX_BYTES = 15 * 1024 * 1024;

/** POST /api/maintenance/issues/:id/documents — multipart `file`, `kind` (pod/invoice). Backs the
 *  expense on the owner statement. Stored in R2 (binding MEDIA); without that binding the request
 *  is refused, not faked. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'File upload is not set up yet. Ask an administrator to enable media storage.', 501);

  const id = String(params.id);
  const issue = await one<{ id: string; unit_id: string }>(env, 'SELECT id, unit_id FROM maintenance_issues WHERE id = ?', id);
  if (!issue) return fail('NOT_FOUND', 'That job no longer exists.', 404);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail('VALIDATION', 'Attach a file.', 422);
  if (file.size > MAX_BYTES) return fail('VALIDATION', 'That file is too large (15 MB limit).', 422);
  const kind = ['pod', 'invoice'].includes(String(form?.get('kind'))) ? String(form?.get('kind')) : 'other'; // counted as a document, not a photo

  const docId = crypto.randomUUID();
  const key = `maintenance/${id}/${docId}`;
  await env.MEDIA.put(key, file, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  await run(env, `
    INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, unit_id, maintenance_id, uploaded_by, captured_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    docId, kind, file.name.slice(0, 120), file.type || 'application/octet-stream', file.size, key, issue.unit_id, id, session.userId, nowIso(), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.document', entityTable: 'maintenance_issues', entityId: id, after: { documentId: docId, kind } });
  return json({ documentId: docId }, 201);
};
