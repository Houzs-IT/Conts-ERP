import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const MANAGE = ['management', 'operations_manager'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all(env, 'SELECT id, provider, state, last_synced_at, last_error FROM integrations ORDER BY provider');

  // Credentials are never serialised, at any role.
  return json({
    generatedAt: new Date().toISOString(),
    data: (rows as any[]).map(r => ({
      id: r.id, provider: r.provider, state: r.state,
      lastSyncedAt: r.last_synced_at, lastError: r.last_error,
    })),
  });
};

/** PATCH — record a reconnection. The OAuth round-trip happens elsewhere; this
 *  only moves the state once the provider has confirmed. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) {
    return fail('FORBIDDEN', 'You can see connection status but cannot change it. Ask an operations manager.', 403);
  }

  const { id, state } = await request.json<{ id: string; state: string }>();
  if (!['connected', 'expired', 'degraded', 'failed'].includes(state)) {
    return fail('VALIDATION', 'Unknown connection state.', 422);
  }

  const before = await one<any>(env, 'SELECT provider, state FROM integrations WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That integration is not configured.', 404);

  await run(env, 'UPDATE integrations SET state = ?, last_synced_at = ?, last_error = ? WHERE id = ?',
    state, state === 'connected' ? nowIso() : null, state === 'connected' ? null : before.last_error, id);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'integration.' + state,
    entityTable: 'integrations', entityId: id,
    before: { state: before.state }, after: { state },
  });
  return json({ ok: true });
};
