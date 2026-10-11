import { type Env, all, one, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { assignCleaner, type RosterCleaner } from '../../_lib/ops';

const MAX = 200;

/** POST /api/tasks/bulk-assign { taskIds?: string[], reservationIds?: string[], cleanerId, force? }
 *  Gives one cleaner many cleans at once, from the Cleaning list's ticked rows or from ticked bookings (their open
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
  const cleanerId = typeof b?.cleanerId === 'string' ? b.cleanerId.trim() : '';
  const cleaner = cleanerId ? await one<RosterCleaner>(env,
    'SELECT id, full_name, employment_type, user_id, phone FROM cleaners WHERE id = ? AND is_active = 1', cleanerId) : null;
  if (!cleaner) return fail('VALIDATION', 'Pick a cleaner from the active roster.', 422, { cleanerId: 'Pick a cleaner.' });

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
    const res = await assignCleaner(env, session, id, { ...cleaner, busy: 0 }, b?.force === true);
    if (res.ok) { assigned++; continue; }
    const body = await res.json<any>().catch(() => null);
    skipped.push({ id, reason: body?.error?.message ?? 'Not assigned.' });
  }
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.bulk_assign', entityTable: 'cleaners', entityId: cleaner.id,
    after: { cleaner: cleaner.full_name, assigned, skipped: skipped.length, tasks: targets.length, fromBookings: reservationIds.length },
  });
  return json({ assigned, skipped, cleaner: cleaner.full_name });
};
