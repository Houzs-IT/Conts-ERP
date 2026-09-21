import { type Env, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** GET /api/documents/:id/download — see documents/index.ts: no file storage yet. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  return fail('NOT_CONFIGURED', 'File download is not set up yet. Ask an administrator to enable media storage.', 501);
};
