import { type Env, one, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** GET /api/documents/:id/download — stream a stored file (R2, binding MEDIA).
 *  Files are written by POST /api/tasks/:id/photos; this is the matching read
 *  path used by the housekeeping POD gallery. Without the MEDIA binding there is
 *  nothing to serve, so it refuses (501) rather than pretend, mirroring upload. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'File download is not set up yet. Ask an administrator to enable media storage.', 501);

  const id = String(params.id);
  const doc = await one<{ storage_key: string; mime_type: string; file_name: string }>(env,
    'SELECT storage_key, mime_type, file_name FROM documents WHERE id = ?', id);
  if (!doc) return fail('NOT_FOUND', 'That file no longer exists.', 404);

  const object = await env.MEDIA.get(doc.storage_key);
  if (!object) return fail('NOT_FOUND', 'That file is missing from storage.', 404);

  const headers = new Headers();
  headers.set('Content-Type', doc.mime_type || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${doc.file_name.replace(/[^\x20-\x7e]/g, '_')}"`);
  headers.set('Cache-Control', 'private, max-age=3600');
  const etag = object.httpEtag;
  if (etag) headers.set('ETag', etag);
  return new Response(object.body, { headers });
};
