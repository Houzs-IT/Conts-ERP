import { type Env, one, fail } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { hasAttendance, NOT_MIGRATED } from '../../../../_lib/attendance';

/** GET /api/attendance/:id/photo/in|out — a punch selfie, for HR > Workers > Attendance. The shared download endpoint
 *  only knows unit, job and owner files, so selfies are served here, under the HR area. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Selfies are kept by the office.', 403);
  if (!(await hasAttendance(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'Media storage is not set up.', 501);
  const side = String(params.side);
  if (side !== 'in' && side !== 'out') return fail('NOT_FOUND', 'Ask for the clock-in or the clock-out photo.', 404);

  const doc = await one<{ storage_key: string; mime_type: string }>(env, `
    SELECT d.storage_key, d.mime_type FROM attendance a JOIN documents d ON d.id = ${side === 'in' ? 'a.in_photo_id' : 'a.out_photo_id'}
    WHERE a.id = ?`, String(params.id));
  if (!doc) return fail('NOT_FOUND', 'No photo with that punch.', 404);
  const object = await env.MEDIA.get(doc.storage_key);
  if (!object) return fail('NOT_FOUND', 'The photo file is missing from storage.', 404);
  return new Response(object.body, { headers: { 'Content-Type': doc.mime_type, 'Cache-Control': 'private, max-age=3600' } });
};
