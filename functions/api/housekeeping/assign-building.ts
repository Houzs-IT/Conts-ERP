import { mayWork } from '../../_lib/access';
import { type Env, all, one, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { assignCleaner, MYT_DATE, type RosterCleaner } from '../../_lib/ops';
import { CLEAN_KINDS_SQL, isDay } from '../../_lib/cleaning';
import { notifyUsers } from '../../_lib/notify';
import { day } from '../../_lib/notices';

/** POST /api/housekeeping/assign-building { buildingId, date, cleanerId, onlyUnassigned? }
 *  Every unfinished clean in one building on one day goes to one cleaner (time clashes are accepted: the
 *  cleaner works the building in one round). `onlyUnassigned` leaves cleans that already have someone. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management', 'operations_manager', 'operations_staff'])) return fail('FORBIDDEN', 'Only operations can assign cleaning.', 403);

  const b = await request.json<any>().catch(() => null);
  if (typeof b?.buildingId !== 'string' || !b.buildingId) return fail('VALIDATION', 'Say which building.', 422, { buildingId: 'Pick a building.' });
  if (!isDay(b?.date)) return fail('VALIDATION', 'Say which day.', 422, { date: 'Pick a day.' });
  if (typeof b?.cleanerId !== 'string' || !b.cleanerId) return fail('VALIDATION', 'Pick a cleaner.', 422, { cleanerId: 'Pick a cleaner.' });

  const cleaner = await one<RosterCleaner>(env, 'SELECT id, full_name, employment_type, user_id, phone FROM cleaners WHERE id = ? AND is_active = 1', b.cleanerId);
  if (!cleaner) return fail('NOT_FOUND', 'That cleaner is not on the active roster.', 404, { cleanerId: 'Pick a cleaner from the roster.' });

  const tasks = await all<{ id: string }>(env, `
    SELECT t.id FROM tasks t JOIN units u ON u.id = t.unit_id
    WHERE u.property_id = ? AND t.kind IN ${CLEAN_KINDS_SQL} AND t.state != 'resolved'
      AND ${MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)')} = ?
      ${b.onlyUnassigned ? 'AND t.cleaner_id IS NULL AND t.assignee_id IS NULL' : ''}`, b.buildingId, b.date);
  if (!tasks.length) return fail('NOTHING_TO_ASSIGN', 'There is no unfinished clean in that building on that day.', 409);

  let assigned = 0;
  for (const t of tasks) {
    const res = await assignCleaner(env, session, t.id, { ...cleaner, busy: 0 }, true, true);
    if (res.ok) assigned++;
  }
  if (assigned && cleaner.user_id) {
    await notifyUsers(env, [cleaner.user_id], { kind: 'cleaning.assigned', title: `${assigned} ${assigned === 1 ? 'clean' : 'cleans'} assigned to you`, body: `For ${day(b.date)}. Open My jobs to see the units and times.`, link: '/operations/cleaning', entityTable: 'properties', entityId: b.buildingId, dedupeKey: `building-${b.buildingId}-${b.date}-${cleaner.id}`, except: session.userId });
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.assign_building', entityTable: 'properties', entityId: b.buildingId, after: { date: b.date, cleanerId: cleaner.id, assigned } });
  return json({ ok: true, assigned, assigneeName: cleaner.full_name });
};
