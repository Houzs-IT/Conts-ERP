import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { parseSavedReply } from '../../../_lib/savedReplies';

async function guard(request: Request, env: Env) {
  const { session, response } = await requireSession(request, env);
  if (!session) return { response: response! };
  if (isFieldRole(session.role) || session.role === 'owner') return { response: fail('FORBIDDEN', 'The inbox is for operations and management.', 403) };
  if (!mayWork(session, ['management', 'operations_manager', 'operations_staff'])) return { response: fail('FORBIDDEN', 'You can use saved replies but not change them.', 403) };
  return { session };
}

/** PATCH /api/messages/saved-replies/:id { title, body } */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(request, env);
  if (!g.session) return g.response;
  const id = String(params.id);
  const before = await one<{ title: string; body: string }>(env, 'SELECT title, body FROM saved_replies WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That saved reply no longer exists.', 404);
  const v = parseSavedReply(await request.json<any>().catch(() => null));
  if ('error' in v) return v.error;
  const now = nowIso();
  await run(env, 'UPDATE saved_replies SET title = ?, body = ?, updated_at = ? WHERE id = ?', v.title, v.body, now, id);
  await audit(env, { actorId: g.session.userId, actorLabel: g.session.fullName, action: 'saved_reply.update', entityTable: 'saved_replies', entityId: id, before: { title: before.title }, after: { title: v.title } });
  return json({ id, title: v.title, body: v.body, updatedAt: now });
};

/** DELETE /api/messages/saved-replies/:id — nothing else refers to a saved reply, so it simply goes. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const g = await guard(request, env);
  if (!g.session) return g.response;
  const id = String(params.id);
  const before = await one<{ title: string; body: string }>(env, 'SELECT title, body FROM saved_replies WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That saved reply no longer exists.', 404);
  await run(env, 'DELETE FROM saved_replies WHERE id = ?', id);
  await audit(env, { actorId: g.session.userId, actorLabel: g.session.fullName, action: 'saved_reply.delete', entityTable: 'saved_replies', entityId: id, before });
  return json({ ok: true });
};
