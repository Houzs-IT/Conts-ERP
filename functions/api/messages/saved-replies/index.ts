import { mayWork } from '../../../_lib/access';
import { type Env, all, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { parseSavedReply } from '../../../_lib/savedReplies';

/** GET /api/messages/saved-replies — every saved reply, by name. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'The inbox is for operations and management.', 403);
  const rows = await all<any>(env, `SELECT s.id, s.title, s.body, s.updated_at, u.full_name AS created_by_name FROM saved_replies s LEFT JOIN users u ON u.id = s.created_by ORDER BY lower(s.title), s.id`);
  return json({ data: rows.map(r => ({ id: r.id, title: r.title, body: r.body, updatedAt: r.updated_at, createdByName: r.created_by_name ?? null })) });
};

/** POST /api/messages/saved-replies { title, body } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'The inbox is for operations and management.', 403);
  if (!mayWork(session, ['management', 'operations_manager', 'operations_staff'])) return fail('FORBIDDEN', 'You can use saved replies but not change them.', 403);
  const v = parseSavedReply(await request.json<any>().catch(() => null));
  if ('error' in v) return v.error;
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, 'INSERT INTO saved_replies (id, title, body, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, v.title, v.body, session.userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'saved_reply.create', entityTable: 'saved_replies', entityId: id, after: { title: v.title } });
  return json({ id, title: v.title, body: v.body, updatedAt: now }, 201);
};
