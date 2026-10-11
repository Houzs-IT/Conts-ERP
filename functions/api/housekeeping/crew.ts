import { type Env, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { crew } from '../../_lib/ops';

/** GET /api/housekeeping/crew?scope=housekeeping|all — the people work can be assigned to, with today's load. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot see the cleaner list.', 403);

  const scope = new URL(request.url).searchParams.get('scope') === 'all' ? 'all' : 'housekeeping';
  return json({ data: await crew(env, scope).then(rows => rows.map(r => ({ id: r.id, name: r.name, busy: Number(r.busy) }))) });
};
