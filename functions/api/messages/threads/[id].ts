import { type Env, run, json, fail } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';

/** PATCH /api/messages/threads/:id { isRead } */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'The inbox is for operations and management.', 403);
  const b = await request.json<any>().catch(() => null);
  if (typeof b?.isRead !== 'boolean') return fail('VALIDATION', 'Say whether it is read.', 422);
  await run(env, 'UPDATE message_threads SET is_read = ? WHERE id = ?', b.isRead ? 1 : 0, String(params.id));
  return json({ ok: true });
};
