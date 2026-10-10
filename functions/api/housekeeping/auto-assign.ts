import { mayWork } from '../../_lib/access';
import { type Env, all, one, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { assignCleaner, activeCleaners, MYT_DATE } from '../../_lib/ops';
import { notifyUsers } from '../../_lib/notify';

const ORDER: Record<string, string> = {
  earliest_checkin: 'COALESCE(t.next_guest_at, t.due_at, t.created_at)',
  building: 'p.name, u.unit_number',
  manual: 't.created_at',
};

const setting = async (env: Env, key: string, fallback: string) =>
  (await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', key))?.value ?? fallback;

/** POST /api/housekeeping/auto-assign { rule?, prefer?, strategy? } — every
 *  unassigned clean from today on is given to a roster cleaner. The ordering rule,
 *  the employment preference (internal / outsourced / any) and the spread strategy
 *  (least-loaded or round-robin) default to the saved auto-assign rules. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management', 'operations_manager', 'operations_staff'])) return fail('FORBIDDEN', 'Only operations can auto-assign.', 403);

  const b = await request.json<any>().catch(() => ({}));
  const rule = b?.rule in ORDER ? b.rule : await setting(env, 'housekeeping.ordering_rule', 'earliest_checkin');
  const orderBy = ORDER[rule] ?? ORDER.earliest_checkin;
  const prefer = ['internal', 'outsourced', 'any'].includes(b?.prefer) ? b.prefer : await setting(env, 'housekeeping.assign_prefer', 'any');
  const strategy = ['least_loaded', 'round_robin'].includes(b?.strategy) ? b.strategy : await setting(env, 'housekeeping.assign_strategy', 'least_loaded');

  const people = await activeCleaners(env, prefer as 'internal' | 'outsourced' | 'any');
  if (!people.length) return fail('NO_CREW', 'There are no active cleaners on the roster to assign to.', 409);
  const load = new Map(people.map(p => [p.id, Number(p.busy)]));

  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const tasks = await all<{ id: string }>(env, `
    SELECT t.id FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id
    WHERE t.cleaner_id IS NULL AND t.assignee_id IS NULL AND t.state IN ('open','reopened') AND t.kind IN ('turnover','deep_clean','light_clean')
      AND ${MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)')} >= ?
    ORDER BY ${orderBy}`, today);

  let assigned = 0, rr = 0;
  const given = new Map<string, string[]>();
  for (const t of tasks) {
    // least_loaded picks the cleaner with the fewest open jobs; round_robin cycles.
    const cleaner = strategy === 'round_robin'
      ? people[rr++ % people.length]
      : people.reduce((a, c) => (load.get(c.id)! <= load.get(a.id)! ? c : a));
    const res = await assignCleaner(env, session, t.id, { ...cleaner, busy: 0 }, true, true);
    if (res.ok) { assigned++; load.set(cleaner.id, (load.get(cleaner.id) ?? 0) + 1); given.set(cleaner.id, [...(given.get(cleaner.id) ?? []), t.id]); }
  }
  for (const [cid, ids] of given) {
    const c = people.find(p => p.id === cid);
    if (c?.user_id) await notifyUsers(env, [c.user_id], { kind: 'cleaning.assigned', title: `${ids.length} ${ids.length === 1 ? 'clean' : 'cleans'} assigned to you`, body: 'Open Cleaning to see the units and times.', link: '/operations/cleaning', entityTable: 'tasks', entityId: ids[0], except: session.userId });
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.auto_assign', entityTable: 'tasks', entityId: 'auto', after: { rule, prefer, strategy, assigned } });
  return json({ ok: true, assigned });
};
