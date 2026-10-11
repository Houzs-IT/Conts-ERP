import { type Env, one, fail } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { levelsFor } from '../../../_lib/access';
import { isAssignee, UNASSIGNED_SQL } from '../../../_lib/maintenance';

const INLINE_TYPES = /^(?:image\/(?:png|jpe?g|gif|webp|heic|heif|avif)|video\/(?:mp4|quicktime|webm)|application\/pdf)$/;

interface Doc { storage_key: string; mime_type: string; file_name: string; unit_id: string | null; owner_id: string | null; task_id: string | null; maintenance_id: string | null; visible_to_owner: number | boolean; uploaded_by: string | null }

/** Whether this person may open the file: the file's own record decides, not knowing its id. An owner gets only
 *  files staff marked visible to them; a housekeeper or technician only files on their own jobs (and a technician the photos of a repair nobody has yet); desk roles need
 *  access to the area the file belongs to (a unit's or a job's files: Properties or Operations; an owner's own
 *  papers and receipts: Owners or Finance). */
async function mayOpen(env: Env, s: { userId: string; role: string }, d: Doc): Promise<boolean> {
  if (s.role === 'management') return true;
  if (s.role === 'owner') {
    if (!d.owner_id || !d.visible_to_owner) return false;
    return !!(await one(env, 'SELECT 1 AS x FROM owners WHERE id = ? AND user_id = ?', d.owner_id, s.userId));
  }
  if (isFieldRole(s.role)) {
    if (d.uploaded_by === s.userId) return true;
    if (d.task_id) {
      return !!(await one(env, `
        SELECT 1 AS x FROM tasks t LEFT JOIN cleaners c ON c.id = t.cleaner_id
        WHERE t.id = ? AND (t.assignee_id = ? OR t.completed_by = ? OR c.user_id = ?)`, d.task_id, s.userId, s.userId, s.userId));
    }
    if (d.maintenance_id) {
      // The person who reported the repair, the one doing it, and (to look before picking it up) any technician while nobody has it.
      if (await one(env, 'SELECT 1 AS x FROM maintenance_issues WHERE id = ? AND reported_by = ?', d.maintenance_id, s.userId)) return true;
      if (await isAssignee(env, d.maintenance_id, s.userId)) return true;
      return s.role === 'technician' && !!(await one(env, `SELECT 1 AS x FROM maintenance_issues m WHERE m.id = ? AND ${UNASSIGNED_SQL} AND m.state IN ('open','reopened')`, d.maintenance_id));
    }
    return false;
  }
  const lv = await levelsFor(env, s.role);
  if (d.unit_id || d.task_id || d.maintenance_id) return lv.properties !== 'none' || lv.operations !== 'none';
  return lv.owners !== 'none' || lv.finance !== 'none';
}

/** GET /api/documents/:id/download — stream a stored file (R2, binding MEDIA): job photos, unit contracts and
 *  photos, expense receipts, files shared with an owner. Without the MEDIA binding there is nothing to serve, so
 *  it refuses (501) rather than pretend, mirroring upload. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const doc = await one<Doc>(env,
    'SELECT storage_key, mime_type, file_name, unit_id, owner_id, task_id, maintenance_id, visible_to_owner, uploaded_by FROM documents WHERE id = ?', id);
  // Refused and missing answer alike, so an id cannot be used to learn that a file exists.
  if (!doc || !(await mayOpen(env, session, doc))) return fail('NOT_FOUND', 'That file no longer exists.', 404);
  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'File download is not set up yet. Ask an administrator to enable media storage.', 501);

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
