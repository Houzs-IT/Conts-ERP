import { type Env, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { hubFor, relay, REQUEST_CODE } from '../../../../_lib/itHub';

/** GET /api/it-support/tickets/:code — one of the signed-in person's own IT requests (session.userId) with what IT
 *  has said on it. Opening it marks it read, so its count leaves the menu. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { hub, refusal } = hubFor(env, session);
  if (!hub) return refusal;
  const code = String(params.code);
  if (!REQUEST_CODE.test(code)) return fail('NOT_FOUND', 'That IT request could not be found.', 404);
  return relay(hub, `/tickets/${code}`);
};
