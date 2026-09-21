import { type Env, all, one, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { assignTask, crew, MYT_DATE } from '../../_lib/ops';

const ORDER: Record<string, string> = {
  earliest_checkin: 'COALESCE(t.next_guest_at, t.due_at, t.created_at)',
  building: 'p.name, u.unit_number',
  manual: 't.created_at',
};

/** POST /api/housekeeping/auto-assign { rule } — every unassigned cleaning task from today on goes to the least-loaded cleaner. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager', 'operations_staff'].includes(session.role)) return fail('FORBIDDEN', 'Only operations can auto-assign.', 403);

  const b = await request.json<any>().catch(() => ({}));
  const rule = b?.rule in ORDER ? b.rule : 'earliest_checkin';

  const people = await crew(env, 'housekeeping');
  if (!people.length) return fail('NO_CREW', 'There are no active cleaners to assign to.', 409);
  const load = new Map(people.map(p => [p.id, Number(p.busy)]));

  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const tasks = await all<{ id: string }>(env, `
    SELECT t.id FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id
    WHERE t.assignee_id IS NULL AND t.state IN ('open','reopened') AND t.kind IN ('turnover','deep_clean','light_clean')
      AND ${MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)')} >= ?
    ORDER BY ${ORDER[rule]}`, today);

  let assigned = 0;
  for (const t of tasks) {
    const [id] = [...load.entries()].sort((a, c) => a[1] - c[1])[0];
    const res = await assignTask(env, session, t.id, id, true);
    if (res.ok) { assigned++; load.set(id, (load.get(id) ?? 0) + 1); }
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.auto_assign', entityTable: 'tasks', entityId: 'auto', after: { rule, assigned } });
  return json({ ok: true, assigned });
};
