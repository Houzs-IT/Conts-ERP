import { type Env } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hubFor, relay } from '../../_lib/itHub';

/** GET /api/it-support/unread-count — how many of the signed-in person's own IT requests (session.userId) IT has
 *  answered since they last opened them. The menu's count; polled. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { hub, refusal } = hubFor(env, session);
  if (!hub) return refusal;
  return relay(hub, '/tickets/unread-count');
};
