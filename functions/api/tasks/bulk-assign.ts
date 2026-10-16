import { type Env, all, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { assignCleaners, rosterByIds, pickedCleanerIds } from '../../_lib/ops';

const MAX = 200;

/** POST /api/tasks/bulk-assign { taskIds?: string[], reservationIds?: string[], cleanerIds | cleanerId, force? }
 *  Gives one or more cleaners (all of them on every job) many cleans at once, from the Cleaning list's ticked rows or from ticked bookings (their open
 *  turnover cleans). Each task goes through the same assignCleaner as one at a time, so each is audited and the
 *  cleaner notified the same way; a clean that clashes with the cleaner's other work (or is finished) is skipped
 *  with the reason unless force. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot assign work.', 403);

  const b = await request.json<any>().catch(() => null);
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()))] : []);
  const taskIds = ids(b?.taskIds), reservationIds = ids(b?.reservationIds);
  if (!taskIds.length && !reservationIds.length) return fail('VALIDATION', 'Tick at least one row.', 422);
  if (taskIds.length + reservationIds.length > MAX) return fail('VALIDATION', `At most ${MAX} at a time.`, 422);
  const pickedIds = pickedCleanerIds(b);
  const team = pickedIds.length ? await rosterByIds(env, pickedIds) : null;
  if (!team?.length) return fail('VALIDATION', 'Pick a cleaner from the active roster.', 422, { cleanerId: 'Pick a cleaner.' });
  const names = team.map(c => c.full_name).join(', ');

  // A booking's clean is its open turnover (or other clean) linked to it.
  const fromBookings = reservationIds.length ? await all<{ id: string; reservation_id: string }>(env, `
    SELECT t.id, t.reservation_id FROM tasks t
    WHERE t.reservation_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
      AND t.kind IN ('turnover','deep_clean','light_clean') AND t.state <> 'resolved'`, JSON.stringify(reservationIds)) : [];
  const withClean = new Set(fromBookings.map(t => t.reservation_id));
  const targets = [...new Set([...taskIds, ...fromBookings.map(t => t.id)])];

  let assigned = 0;
  const skipped: { id: string; reason: string }[] = reservationIds.filter(r => !withClean.has(r)).map(id => ({ id, reason: 'No open cleaning job is linked to this reservation.' }));
  for (const id of targets) {
    const res = await assignCleaners(env, session, id, team, b?.force === true);
    if (res.ok) { assigned++; continue; }
    const body = await res.json<any>().catch(() => null);
    skipped.push({ id, reason: body?.error?.message ?? 'Not assigned.' });
  }
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.bulk_assign', entityTable: 'cleaners', entityId: team[0].id,
    after: { cleaner: names, cleanerIds: team.map(c => c.id), assigned, skipped: skipped.length, tasks: targets.length, fromBookings: reservationIds.length },
  });
  return json({ assigned, skipped, cleaner: names });
};
