import { type Env, all, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';

/** POST /api/housekeeping/plan { reservationIds } — one turnover clean per departing stay.
 *  The window opens at the stay's check-out and closes at the next guest's check-in that day,
 *  if there is one. A stay that already has a clean on its unit that day is skipped, so a
 *  double click or two people planning at once never makes a second task. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot plan cleaning.', 403);

  const b = await request.json<any>().catch(() => null);
  const ids: string[] = Array.isArray(b?.reservationIds) ? [...new Set(b.reservationIds.filter((x: unknown) => typeof x === 'string' && x))] as string[] : [];
  if (!ids.length) return fail('VALIDATION', 'Pick at least one check-out to plan.', 422);
  if (ids.length > 300) return fail('VALIDATION', 'Plan at most 300 check-outs at a time.', 422);

  const now = nowIso();
  const day = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const created = await all<{ id: string; reservation_id: string }>(env, `
    INSERT INTO tasks (id, unit_id, reservation_id, kind, state, title, scheduled_for, due_at, next_guest_at, requires_photo, created_at, updated_at)
    SELECT gen_random_uuid()::text, r.unit_id, r.id, 'turnover', 'open', 'Turnover after check-out',
           r.check_out || 'T' || COALESCE(NULLIF(r.check_out_time, ''), '11:00') || ':00+08:00',
           CASE WHEN n.check_in_time IS NOT NULL THEN r.check_out || 'T' || n.check_in_time || ':00+08:00' END,
           CASE WHEN n.check_in_time IS NOT NULL THEN r.check_out || 'T' || n.check_in_time || ':00+08:00' END,
           1, ?, ?
    FROM reservations r
    LEFT JOIN LATERAL (
      SELECT x.check_in_time FROM reservations x WHERE x.unit_id = r.unit_id AND x.check_in = r.check_out AND x.id != r.id
        AND x.state NOT IN ('cancelled','no_show','inquiry') AND x.channel != 'maintenance_block' LIMIT 1
    ) n ON TRUE
    WHERE r.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
      AND r.state NOT IN ('cancelled','no_show','inquiry') AND r.channel != 'maintenance_block'
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.reservation_id = r.id AND t.kind IN ('turnover','deep_clean','light_clean'))
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.unit_id = r.unit_id AND t.kind IN ('turnover','deep_clean','light_clean') AND ${day} = r.check_out)
    RETURNING id, reservation_id`, now, now, JSON.stringify(ids));

  if (created.length) {
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.plan', entityTable: 'tasks',
      entityId: created.length === 1 ? created[0].id : `${created.length} tasks`,
      after: { created: created.map(c => ({ taskId: c.id, reservationId: c.reservation_id })) }, source: b?.source ?? 'web',
    });
  }
  return json({ created: created.length, skipped: ids.length - created.length, taskIds: created.map(c => c.id) }, created.length ? 201 : 200);
};
