import { type Env, fail } from '../../../../_lib/db';
import { requireSession, hasColumn } from '../../../../_lib/auth';
import { giveFieldAccess } from '../../../../_lib/fieldAccess';

/** POST /api/employees/renovators/:id/access — "Give app access" / "Reset PIN" for a Renovation employee
 *  (functions/_lib/fieldAccess.ts). Management and operations managers only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await hasColumn(env, 'renovators', 'employment_type').catch(() => false))) {
    return fail('NOT_MIGRATED', 'Renovation app access needs a database update (migration 0316) that has not been applied yet.', 503);
  }
  return giveFieldAccess(env, session, 'renovators', String(params.id));
};
