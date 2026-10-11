import { type Env, one, run, json, fail, audit } from '../../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../../_lib/auth';

/** DELETE /api/maintenance/issues/:id/windows/:wid — the window no longer holds (the guest changed their mind). */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change repair windows.', 403);
  const w = await one<{ id: string; starts_at: string; ends_at: string }>(env, 'SELECT id, starts_at, ends_at FROM maintenance_windows WHERE id = ? AND issue_id = ?', String(params.wid), String(params.id));
  if (!w) return fail('NOT_FOUND', 'That window was already removed.', 404);
  await run(env, 'DELETE FROM maintenance_windows WHERE id = ?', w.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.window_remove', entityTable: 'maintenance_issues', entityId: String(params.id), before: { windowId: w.id, startsAt: w.starts_at, endsAt: w.ends_at } });
  return json({ ok: true });
};
