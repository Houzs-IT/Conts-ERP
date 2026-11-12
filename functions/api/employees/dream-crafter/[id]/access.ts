import { type Env, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { giveFieldAccess } from '../../../../_lib/fieldAccess';

/** POST /api/employees/dream-crafter/:id/access — "Give app access" / "Reset PIN" for a Dream Crafter employee
 *  (functions/_lib/fieldAccess.ts). Management and Full on Dream Crafter > HR > Employees only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response ?? fail('UNAUTHENTICATED', 'Your session expired. Sign in to continue.', 401);
  return giveFieldAccess(env, session, 'dc_staff', String(params.id));
};
