import { mayRun } from '../../../_lib/access';
import { type Env, one, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** POST /api/integrations/:provider/connect — channels are connected per unit through Channex, so this points
 *  staff to the unit's Channels card rather than connecting anything here. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, ['management', 'operations_manager'])) return fail('FORBIDDEN', 'You can see connection status but cannot change it. Ask an operations manager.', 403);

  const row = await one<{ id: string }>(env, 'SELECT id FROM integrations WHERE provider = ?', String(params.provider));
  if (!row) return fail('NOT_FOUND', 'That integration is not configured.', 404);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'integration.reconnect_requested', entityTable: 'integrations', entityId: row.id });
  return fail('CONNECT_PER_UNIT', 'Channels are connected per unit. Open the unit (Properties, then Units) and use Connect channels on its Channels card.', 409);
};
