import { type Env, all, fail } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { setCleaners, type RosterCleaner } from '../../../../_lib/ops';

/** PUT /api/housekeeping/tasks/:id/cleaners { cleanerIds: string[] } — the whole crew of a cleaning job. Any number of
 *  cleaners, none of them a lead; an empty list takes everyone off. Each newly added internal cleaner is notified. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot assign work.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!Array.isArray(b?.cleanerIds)) return fail('VALIDATION', 'Pick the cleaners.', 422, { cleanerIds: 'Pick the cleaners.' });
  const ids = [...new Set((b.cleanerIds as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim()))];
  if (ids.length > 20) return fail('VALIDATION', 'At most 20 cleaners on one job.', 422);
  const found = ids.length ? await all<RosterCleaner>(env, `
    SELECT id, full_name, employment_type, user_id, phone, 0 AS busy FROM cleaners WHERE is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  if (found.length !== ids.length) return fail('NOT_FOUND', 'A cleaner you picked is not on the active roster. Refresh and pick again.', 404);
  // Keep the order they were picked in: the first is who the single-cleaner screens show.
  const ordered = ids.map(id => found.find(c => c.id === id)!);
  return setCleaners(env, session, String(params.id), ordered, 'replace');
};
