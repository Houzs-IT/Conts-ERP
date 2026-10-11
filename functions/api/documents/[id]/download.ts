import { type Env, one, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

const INLINE_TYPES = /^(?:image\/(?:png|jpe?g|gif|webp|heic|heif|avif)|video\/(?:mp4|quicktime|webm)|application\/pdf)$/;

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

  // Files come from anyone who can upload, and are served from the app's own address: an .html or .svg shown inline
  // would run its script as the person opening it. Only types a browser cannot run are shown inline; everything else
  // downloads, the type is never guessed, and the sandbox stops script even if a browser renders it anyway.
  const type = (doc.mime_type || '').toLowerCase();
  const inline = INLINE_TYPES.test(type);
  const headers = new Headers();
  headers.set('Content-Type', inline ? type : 'application/octet-stream');
  headers.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${doc.file_name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`);
  headers.set('X-Content-Type-Options', 'nosniff');
  // Not on a PDF: Chrome refuses to open a PDF under a sandbox policy, and its viewer keeps a PDF's script off the page.
  if (type !== 'application/pdf') headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  headers.set('Cache-Control', 'private, max-age=3600');
  const etag = object.httpEtag;
  if (etag) headers.set('ETag', etag);
  return new Response(object.body, { headers });
};
