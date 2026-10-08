import { type Env, json, fail } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { applyMove, isRefusal } from '../../../_lib/bookingLifecycle';

/** POST /api/reservations/:id/cancel { reason } — the same move as PATCH { state: 'cancelled' }: checked against the
 *  allowed map, releases the dates on the channels if the unit is linked, and answers with what actually happened. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot cancel reservations.', 403);

  const b = await request.json<any>().catch(() => ({}));
  const r = await applyMove(env, session, String(params.id), 'cancelled', typeof b?.reason === 'string' ? b.reason : null);
  if (isRefusal(r)) return json(r.body, r.status);
  return json(r);
};
