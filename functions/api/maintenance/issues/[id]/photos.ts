import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { mediaKind } from '../../../../_lib/media';

/** POST /api/maintenance/issues/:id/photos — multipart `file` (a photo or a video), optional `kind` (before/after).
 *  Stored in R2 (binding MEDIA); without that binding the request is refused, not faked. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'File upload is not set up yet. Ask an administrator to enable media storage.', 501);

  const id = String(params.id);
  const issue = await one<{ id: string; unit_id: string }>(env, 'SELECT id, unit_id FROM maintenance_issues WHERE id = ?', id);
  if (!issue) return fail('NOT_FOUND', 'That job no longer exists.', 404);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail('VALIDATION', 'Attach a photo or a video.', 422);
  const media = mediaKind(file);
  if ('error' in media) return fail('VALIDATION', media.error, 422);
  const stage = String(form?.get('kind') ?? 'before') === 'after' ? 'after' : 'before'; // kept in the file name, not a column

  const docId = crypto.randomUUID();
  const key = `maintenance/${id}/${docId}`;
  await env.MEDIA.put(key, file, { httpMetadata: { contentType: file.type } });
  await run(env, `
    INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, unit_id, maintenance_id, uploaded_by, captured_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    docId, media.kind, `${stage}-${file.name}`.slice(0, 120), file.type, file.size, key, issue.unit_id, id, session.userId, nowIso(), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.photo', entityTable: 'maintenance_issues', entityId: id, after: { documentId: docId, stage, kind: media.kind } });
  return json({ documentId: docId, kind: media.kind }, 201);
};
