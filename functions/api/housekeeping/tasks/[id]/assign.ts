import { type Env, fail } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { assignTask } from '../../../../_lib/ops';

/** POST /api/housekeeping/tasks/:id/assign { assigneeId, force? } — 409 ASSIGNEE_BUSY unless force. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot assign work.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.assigneeId) return fail('VALIDATION', 'Pick who should do this.', 422, { assigneeId: 'Pick a person.' });
  return assignTask(env, session, String(params.id), String(b.assigneeId), b.force === true || new URL(request.url).searchParams.get('force') === 'true');
};
