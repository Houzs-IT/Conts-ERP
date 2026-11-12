import { type Env, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees } from '../../_lib/hr';

/** GET /api/employees/master — HR > Employees > Employee Master: the cleaners, the technicians and the Renovation department. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response ?? fail('UNAUTHENTICATED', 'Sign in first.', 401);
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Employee records are kept by the office.', 403);
  if (!(await hasEmployees(env))) return fail('NOT_MIGRATED', 'The employee record needs a database update (migration 0165) that has not been applied yet.', 503);
  return json({ data: await listEmployees(env) });
};
