import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/**
 * GET /api/units/tasks?unitId=&from=YYYY-MM-DD&to=YYYY-MM-DD — a unit's cleans and tasks due (or done) in those
 * dates, newest first, for the unit record's Housekeeping tab. Either date may be left out; at most 500 rows.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  if (!unitId) return fail('VALIDATION', 'A unit is required.', 422);
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return fail('VALIDATION', 'Dates must look like 2026-10-01.', 422);

  const unit = await one<{ owner_id: string }>(env, 'SELECT owner_id FROM units WHERE id = ?', unitId);
  if (!unit) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  if (session.role === 'owner') {
    const owned = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owners WHERE id = ? AND user_id = ?', unit.owner_id, session.userId);
    if (!owned?.n) return fail('FORBIDDEN', 'This unit is not on your account.', 403);
  }
  // Due or done dates are stamped in Malaysia time (+08:00); the first ten characters are the local day.
  const rows = await all<any>(env, `
    SELECT t.id, t.title, t.kind, t.state, t.due_at, t.completed_at, us.full_name AS assignee_name
    FROM tasks t LEFT JOIN users us ON us.id = t.assignee_id
    WHERE t.unit_id = ?
      ${from ? 'AND substr(COALESCE(t.completed_at, t.due_at), 1, 10) >= ?' : ''}
      ${to ? 'AND substr(COALESCE(t.completed_at, t.due_at), 1, 10) <= ?' : ''}
    ORDER BY COALESCE(t.completed_at, t.due_at) DESC NULLS LAST, t.id
    LIMIT 500`, unitId, ...(from ? [from] : []), ...(to ? [to] : []));
  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map(t => ({ id: t.id, title: t.title, kind: t.kind, state: t.state, dueAt: t.due_at, completedAt: t.completed_at, assigneeName: t.assignee_name || null })),
  });
};
