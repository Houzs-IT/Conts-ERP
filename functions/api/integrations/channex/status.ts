import { type Env, one, all, json } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { channexConfigured, channexServer } from '../../../_lib/channex';

/** GET /api/integrations/channex/status — the outbox at a glance: linked units, what is waiting or
 *  failed, and the last calls with Channex's task ids (what the certification form asks for). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return json({ configured: false, restricted: true });

  const linked = await one<{ n: number }>(env, 'SELECT count(*)::int AS n FROM units WHERE channex_property_id IS NOT NULL');
  const q = await one<{ queued: number; failed: number; oldest: string | null }>(env, `
    SELECT count(*) FILTER (WHERE status IN ('queued','sending'))::int AS queued,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           min(created_at) FILTER (WHERE status IN ('queued','sending')) AS oldest
    FROM channex_outbox`);
  const calls = await all<{ kind: string; called_at: string; status: number; task_id: string | null; row_count: number; full_sync: boolean; property_id: string | null; unit: string | null }>(env, `
    SELECT c.kind, c.called_at, c.status, c.task_id, c.row_count, c.full_sync, c.property_id,
           (SELECT u.unit_number FROM units u WHERE u.channex_property_id = c.property_id LIMIT 1) AS unit
    FROM channex_calls c ORDER BY c.called_at DESC LIMIT 25`);
  return json({
    configured: channexConfigured(env),
    server: channexServer(env),
    linkedUnits: linked?.n ?? 0,
    queued: q?.queued ?? 0, failed: q?.failed ?? 0, oldestQueuedAt: q?.oldest ?? null,
    recentCalls: calls.map(c => ({ kind: c.kind, calledAt: c.called_at, status: c.status, taskId: c.task_id, rows: c.row_count, fullSync: c.full_sync, propertyId: c.property_id, unit: c.unit })),
  });
};
