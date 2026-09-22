import { type Env, one, fail } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { assignTask, assignCleaner, type RosterCleaner } from '../../../../_lib/ops';

/** POST /api/housekeeping/tasks/:id/assign { cleanerId | assigneeId, force? }
 *  Prefer cleanerId — the roster entry (internal or outsourced). assigneeId is the
 *  legacy users-based path, kept so nothing that still sends it breaks. Either way
 *  a time clash is a 409 ASSIGNEE_BUSY unless force. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot assign work.', 403);

  const b = await request.json<any>().catch(() => null);
  const force = b?.force === true || new URL(request.url).searchParams.get('force') === 'true';

  if (typeof b?.cleanerId === 'string' && b.cleanerId.trim()) {
    const cleaner = await one<RosterCleaner>(env,
      'SELECT id, full_name, employment_type, user_id, phone FROM cleaners WHERE id = ? AND is_active = 1', b.cleanerId.trim());
    if (!cleaner) return fail('NOT_FOUND', 'That cleaner is not on the active roster.', 404, { cleanerId: 'Pick a cleaner from the roster.' });
    return assignCleaner(env, session, String(params.id), { ...cleaner, busy: 0 }, force);
  }

  if (typeof b?.assigneeId === 'string' && b.assigneeId.trim()) {
    return assignTask(env, session, String(params.id), b.assigneeId.trim(), force);
  }

  return fail('VALIDATION', 'Pick who should do this.', 422, { cleanerId: 'Pick a cleaner.' });
};
