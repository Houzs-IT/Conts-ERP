import { type Env, all, one, run, json, fail } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { THREAD_FROM, THREAD_COLUMNS, threadOut, messageOut } from '../../../_lib/messageThreads';

/** GET /api/messages/threads/:id — one conversation with every message in it, oldest first.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'The inbox is for operations and management.', 403);
  const id = String(params.id);
  const [t, messages] = await Promise.all([
    one<any>(env, `SELECT ${THREAD_COLUMNS} ${THREAD_FROM} WHERE t.id = ?`, id),
    all<any>(env, `SELECT m.*, s.full_name AS sender_name FROM messages m LEFT JOIN users s ON s.id = m.sender_id WHERE m.thread_id = ? ORDER BY m.sent_at, m.id`, id),
  ]);
  if (!t) return fail('NOT_FOUND', 'That conversation no longer exists.', 404);
  return json({ ...threadOut(t), messages: messages.map(messageOut) });
};

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
