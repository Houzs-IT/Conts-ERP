import { type Env, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasPenalties, NOT_MIGRATED, findJobs, type JobOption } from '../../_lib/penalties';

/** GET /api/penalties/jobs?q= — cleaning and repair jobs of the last 120 days matching a unit or title, with who did
 *  them, for the penalty editor (Hookka's production order lookup). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Penalties are kept by the office.', 403);
  if (!(await hasPenalties(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 60);
  const data: JobOption[] = await findJobs(env, q);
  return json({ data });
};
