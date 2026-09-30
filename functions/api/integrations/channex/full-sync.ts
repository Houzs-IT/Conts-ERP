import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { MASTER_ROLES } from '../../../_lib/properties';
import { channexConfigured } from '../../../_lib/channex';
import { queueFullSync, flushChannexQueue } from '../../../_lib/channexQueue';

/** POST /api/integrations/channex/full-sync — resends 500 days of availability, prices and restrictions
 *  for every linked unit, as two calls. Used when going live and to recover after an outage. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can run a full sync.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501);

  const { units } = await queueFullSync(env);
  if (!units) return fail('NOTHING_LINKED', 'No unit is set up in Channex yet. Set a unit up from its Channels card first.', 409);
  const sent = await flushChannexQueue(env, { fullSync: true });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channex.full_sync', entityTable: 'integrations', entityId: 'channex', after: { units, sent } });
  return json({ units, sent });
};
