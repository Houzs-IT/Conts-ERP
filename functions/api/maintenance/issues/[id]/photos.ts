import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';

const MAX_BYTES = 8 * 1024 * 1024;

/** POST /api/maintenance/issues/:id/photos — multipart `file`, optional `kind` (before/after).
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
  if (!(file instanceof File)) return fail('VALIDATION', 'Attach a photo.', 422);
  if (!file.type.startsWith('image/')) return fail('VALIDATION', 'Only photos can be attached.', 422);
  if (file.size > MAX_BYTES) return fail('VALIDATION', 'That photo is too large (8 MB limit).', 422);
  const stage = String(form?.get('kind') ?? 'before'); // before/after — kept in the file name, not a column

  const docId = crypto.randomUUID();
  const key = `maintenance/${id}/${docId}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await run(env, `
    INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, unit_id, maintenance_id, uploaded_by, captured_at, created_at)
    VALUES (?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    docId, `${stage}-${file.name}`.slice(0, 120), file.type, file.size, key, issue.unit_id, id, session.userId, nowIso(), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.photo', entityTable: 'maintenance_issues', entityId: id, after: { documentId: docId, stage } });
  return json({ documentId: docId }, 201);
};
