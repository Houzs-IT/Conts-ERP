import { type Env, all, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { setCleaners, type RosterCleaner } from '../../_lib/ops';

const MAX = 200;

/** POST /api/tasks/bulk-assign { taskIds?: string[], reservationIds?: string[], cleanerId | cleanerIds, mode?, force? }
 *  `cleanerIds` puts several cleaners on every ticked job; `mode` 'add' keeps whoever is already on it, 'replace' (the
 *  default, and what a single `cleanerId` always did) makes them the whole crew. Gives cleaners many cleans at once, from the Cleaning list's ticked rows or from ticked bookings (their open
 *  turnover cleans). Each job goes through the same setCleaners as one at a time, so each is audited and new
 *  cleaners notified the same way; a finished job is skipped with the reason. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot assign work.', 403);

  const b = await request.json<any>().catch(() => null);
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()))] : []);
  const taskIds = ids(b?.taskIds), reservationIds = ids(b?.reservationIds);
  if (!taskIds.length && !reservationIds.length) return fail('VALIDATION', 'Tick at least one row.', 422);
  if (taskIds.length + reservationIds.length > MAX) return fail('VALIDATION', `At most ${MAX} at a time.`, 422);
  const wanted = [...new Set([...(typeof b?.cleanerId === 'string' && b.cleanerId.trim() ? [b.cleanerId.trim()] : []), ...ids(b?.cleanerIds)])];
  const found = wanted.length ? await all<RosterCleaner>(env, `
    SELECT id, full_name, employment_type, user_id, phone, 0 AS busy FROM cleaners WHERE is_active = 1 AND id IN (${wanted.map(() => '?').join(',')})`, ...wanted) : [];
  if (!wanted.length || found.length !== wanted.length) return fail('VALIDATION', 'Pick cleaners from the active roster.', 422, { cleanerId: 'Pick a cleaner.' });
  const crew = wanted.map(id => found.find(c => c.id === id)!);
  const mode: 'add' | 'replace' = b?.mode === 'add' ? 'add' : 'replace';
  const names = crew.map(c => c.full_name).join(', ');

  // A booking's clean is its open turnover (or other clean) linked to it.
  const fromBookings = reservationIds.length ? await all<{ id: string; reservation_id: string }>(env, `
    SELECT t.id, t.reservation_id FROM tasks t
    WHERE t.reservation_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
      AND t.kind IN ('turnover','deep_clean','light_clean') AND t.state <> 'resolved'`, JSON.stringify(reservationIds)) : [];
  const withClean = new Set(fromBookings.map(t => t.reservation_id));
  const targets = [...new Set([...taskIds, ...fromBookings.map(t => t.id)])];

  let assigned = 0;
  const skipped: { id: string; reason: string }[] = reservationIds.filter(r => !withClean.has(r)).map(id => ({ id, reason: 'No open clean is linked to this booking.' }));
  for (const id of targets) {
    const res = await setCleaners(env, session, id, crew, mode);
    if (res.ok) { assigned++; continue; }
    const body = await res.json<any>().catch(() => null);
    skipped.push({ id, reason: body?.error?.message ?? 'Not assigned.' });
  }
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.bulk_assign', entityTable: 'cleaners', entityId: crew[0].id,
    after: { cleaners: names, mode, assigned, skipped: skipped.length, tasks: targets.length, fromBookings: reservationIds.length },
  });
  return json({ assigned, skipped, cleaner: names });
};
