import { type Env } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { giveFieldAccess } from '../../../../_lib/fieldAccess';

/** POST /api/maintenance/technicians/:id/access { phone? } — "Give app access" / "New PIN" for an in-house technician
 *  (functions/_lib/fieldAccess.ts). Management and operations managers only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const b = await request.json<{ phone?: unknown }>().catch(() => null);
  return giveFieldAccess(env, session, 'technicians', String(params.id), b?.phone);
};
