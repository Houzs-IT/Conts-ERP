import { type Env, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { measureHealth } from '../../../_lib/systemHealth';

/** GET /api/system/health — the live state of every moving part (see measureHealth). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'System health is visible to management, finance and operations managers.', 403);
  return json(await measureHealth(env, new URL(request.url).origin));
};
