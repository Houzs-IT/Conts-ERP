import { type Env, one, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** POST /api/integrations/:provider/connect — the provider sign-in (OAuth) is not built yet, so this refuses honestly. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager'].includes(session.role)) return fail('FORBIDDEN', 'You can see connection status but cannot change it. Ask an operations manager.', 403);

  const row = await one<{ id: string }>(env, 'SELECT id FROM integrations WHERE provider = ?', String(params.provider));
  if (!row) return fail('NOT_FOUND', 'That integration is not configured.', 404);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'integration.reconnect_requested', entityTable: 'integrations', entityId: row.id });
  return fail('NOT_CONNECTED', 'Reconnecting a channel is not available yet. It needs the provider sign-in to be set up first.', 501);
};
