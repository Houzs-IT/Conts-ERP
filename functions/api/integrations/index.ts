import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const MANAGE = ['management', 'operations_manager'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all<any>(env, `
    SELECT i.id, i.provider, i.state, i.last_synced_at, i.last_error, i.credentials,
           (SELECT COUNT(*) FROM unit_channels c WHERE c.channel = i.provider AND c.is_active = 1) AS units_linked
    FROM integrations i ORDER BY i.provider`);

  const INTERVAL: Record<string, string | null> = { airbnb: 'Every 15 min', booking_com: 'Every 15 min', agoda: 'Every 15 min', whatsapp: 'Real time', maybank: 'Daily', utilities: null };

  // Credentials are never serialised, at any role: only a masked tail.
  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map(r => ({
      id: r.id, provider: r.provider,
      state: r.provider === 'utilities' ? 'manual' : r.state,
      lastSyncedAt: r.last_synced_at, lastError: r.last_error,
      unitsLinked: Number(r.units_linked),
      syncInterval: INTERVAL[r.provider] ?? 'Every 15 min',
      credentialMasked: r.credentials ? `••••${String(r.credentials).slice(-4)}` : null,
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
