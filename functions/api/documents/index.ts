import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const MAX_BYTES = 8 * 1024 * 1024;

/** POST /api/documents (multipart: file, kind, unitId? or ownerId?) — a unit's contract file or
 *  its listing photo (PropertiesPage's Contract tab, UnitRecordPage's photo drop). Stored in R2
 *  (binding MEDIA); without that binding the request is refused, not faked. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'File upload is not set up yet. Ask an administrator to enable media storage.', 501);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail('VALIDATION', 'Attach a file.', 422);
  if (file.size > MAX_BYTES) return fail('VALIDATION', 'That file is too large (8 MB limit).', 422);
  const kind = String(form?.get('kind') ?? 'other');
  const unitId = form?.get('unitId') ? String(form.get('unitId')) : null;
  const ownerId = form?.get('ownerId') ? String(form.get('ownerId')) : null;

  if (unitId && !(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', unitId))) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  if (ownerId && !(await one(env, 'SELECT 1 AS x FROM owners WHERE id = ?', ownerId))) return fail('NOT_FOUND', 'That owner does not exist.', 404);

  const id = crypto.randomUUID();
  const key = `documents/${unitId ?? ownerId ?? 'general'}/${id}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  await run(env, `
    INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, unit_id, owner_id, uploaded_by, captured_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, kind, file.name.slice(0, 120), file.type || 'application/octet-stream', file.size, key, unitId, ownerId, session.userId, nowIso(), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'document.upload', entityTable: 'documents', entityId: id, after: { kind, unitId, ownerId } });
  return json({ id }, 201);
};
