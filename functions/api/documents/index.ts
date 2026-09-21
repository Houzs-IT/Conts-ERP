import { type Env, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** POST /api/documents (multipart) — file storage (R2, binding MEDIA) is not set up yet, so this refuses instead of pretending. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  return fail('NOT_CONFIGURED', 'File upload is not set up yet. Ask an administrator to enable media storage.', 501);
};
