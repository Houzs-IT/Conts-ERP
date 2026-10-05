import { type Env, all, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { MASTER_ROLES } from '../../../_lib/properties';
import { SENSITIVE_SQL, RANGES } from '../../../_lib/systemHealth';

/** GET /api/system/health/audit-feed?range=24h|7d|30d|90d&sensitive=1&limit= — who changed what in the range:
 *  the latest events (100, or `limit` up to 1000) with their before/after detail, the total in the range, and
 *  counts by action and by resource. Same shape as the Hookka audit feed, with `before`/`after`/`total` added. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'System health is visible to management, finance and operations managers.', 403);

  const url = new URL(request.url);
  const range = url.searchParams.get('range') ?? '7d';
  if (!RANGES[range]) return fail('VALIDATION', 'Pick 24h, 7d, 30d or 90d.', 422);
  const since = new Date(Date.now() - RANGES[range] * 864e5).toISOString();
  const where = `occurred_at >= ?${url.searchParams.get('sensitive') === '1' ? ` AND ${SENSITIVE_SQL}` : ''}`;

  const limit = Math.min(1000, Math.max(1, Math.round(Number(url.searchParams.get('limit')) || 100)));
  const parse = (s: string | null) => { if (!s) return null; try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : { value: v }; } catch { return { value: s }; } };

  const rows = await all<{ id: number; occurred_at: string; actor_id: string | null; actor_label: string; action: string; entity_table: string; entity_id: string; before_state: string | null; after_state: string | null }>(env, `
    SELECT id, occurred_at, actor_id, actor_label, action, entity_table, entity_id, before_state, after_state FROM audit_log WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`, since);
  const total = (await all<{ n: number }>(env, `SELECT count(*)::int AS n FROM audit_log WHERE ${where}`, since))[0]?.n ?? 0;
  const byAction = await all<{ action: string; n: number }>(env, `SELECT action, count(*)::int AS n FROM audit_log WHERE ${where} GROUP BY action ORDER BY n DESC, action LIMIT 8`, since);
  const byResource = await all<{ resource: string; n: number }>(env, `SELECT entity_table AS resource, count(*)::int AS n FROM audit_log WHERE ${where} GROUP BY entity_table ORDER BY n DESC, entity_table LIMIT 8`, since);

  return json({
    success: true, range, total,
    data: rows.map(r => ({ id: r.id, created_at: r.occurred_at, actor_id: r.actor_id, actor_label: r.actor_label, action: r.action, entity_type: r.entity_table, entity_id: r.entity_id, before: parse(r.before_state), after: parse(r.after_state) })),
    summary: { byAction, byResource },
  });
};
