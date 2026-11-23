import { type Env, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { listRenovationBrands } from '../../_lib/hr';

/** GET /api/employees/renovation-brands — the brands a Renovation employee can work under (migration 0324). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Employee records are kept by the office.', 403);
  return json({ data: await listRenovationBrands(env) });
};
