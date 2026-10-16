import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { isOnTask } from '../../../_lib/taskCleaners';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { mediaKind } from '../../../_lib/media';

/** POST /api/tasks/:id/photos — multipart `file`, a photo or a video (proof of work). Stored in R2 (binding MEDIA).
 *  Without that binding the request is refused, not faked. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'Photo upload is not set up yet. Ask an administrator to enable media storage.', 501);

  const id = String(params.id);
  const t = await one<any>(env, 'SELECT id, unit_id, assignee_id FROM tasks WHERE id = ?', id);
  if (!t) return fail('NOT_FOUND', 'That task no longer exists.', 404);
  if (isFieldRole(session.role) && !(await isOnTask(env, t.id, session.userId))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail('VALIDATION', 'Attach a photo or a video.', 422);
  const media = mediaKind(file);
  if ('error' in media) return fail('VALIDATION', media.error, 422);

  const docId = crypto.randomUUID();
  const key = `tasks/${id}/${docId}`;
  await env.MEDIA.put(key, file, { httpMetadata: { contentType: file.type } });
  await run(env, `
    INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, unit_id, task_id, uploaded_by, captured_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    docId, media.kind, file.name.slice(0, 120), file.type, file.size, key, t.unit_id, id, session.userId, nowIso(), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.photo', entityTable: 'tasks', entityId: id, after: { documentId: docId, kind: media.kind }, source: isFieldRole(session.role) ? 'field_app' : 'web' });
  return json({ documentId: docId, kind: media.kind }, 201);
};
