import { type Env, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';

/** See photos.ts: file storage (R2) is not bound yet. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  return fail('NOT_CONFIGURED', 'File upload is not set up yet. Ask an administrator to enable media storage.', 501);
};
