import { type Env } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { giveFieldAccess } from '../../../../_lib/fieldAccess';

/** POST /api/housekeeping/cleaners/:id/access — "Give app access" / "New PIN" for an internal cleaner
 *  (functions/_lib/fieldAccess.ts). Management and operations managers only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  return giveFieldAccess(env, session, 'cleaners', String(params.id));
};
