import { type Env, all, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { MASTER_ROLES } from '../../../_lib/properties';
import { SENSITIVE_SQL, RANGES } from '../../../_lib/systemHealth';

/** GET /api/system/health/audit-feed?range=24h|7d|30d|90d&sensitive=1 — who changed what in the range:
 *  the latest 100 events, and counts by action and by resource. Same shape as the Hookka audit feed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'System health is visible to management, finance and operations managers.', 403);

  const url = new URL(request.url);
  const range = url.searchParams.get('range') ?? '7d';
  if (!RANGES[range]) return fail('VALIDATION', 'Pick 24h, 7d, 30d or 90d.', 422);
  const since = new Date(Date.now() - RANGES[range] * 864e5).toISOString();
  const where = `occurred_at >= ?${url.searchParams.get('sensitive') === '1' ? ` AND ${SENSITIVE_SQL}` : ''}`;

  const rows = await all<{ id: number; occurred_at: string; actor_id: string | null; actor_label: string; action: string; entity_table: string; entity_id: string }>(env, `
    SELECT id, occurred_at, actor_id, actor_label, action, entity_table, entity_id FROM audit_log WHERE ${where} ORDER BY occurred_at DESC LIMIT 100`, since);
  const byAction = await all<{ action: string; n: number }>(env, `SELECT action, count(*)::int AS n FROM audit_log WHERE ${where} GROUP BY action ORDER BY n DESC, action LIMIT 8`, since);
  const byResource = await all<{ resource: string; n: number }>(env, `SELECT entity_table AS resource, count(*)::int AS n FROM audit_log WHERE ${where} GROUP BY entity_table ORDER BY n DESC, entity_table LIMIT 8`, since);

  return json({
    success: true, range,
    data: rows.map(r => ({ id: r.id, created_at: r.occurred_at, actor_id: r.actor_id, actor_label: r.actor_label, action: r.action, entity_type: r.entity_table, entity_id: r.entity_id })),
    summary: { byAction, byResource },
  });
};
