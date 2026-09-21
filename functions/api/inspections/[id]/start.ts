import { type Env, one, run, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** POST /api/inspections/:id/start — the inspector opens the checklist. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const cur = await one<any>(env, 'SELECT id, state, inspector_id FROM inspections WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That inspection no longer exists.', 404);
  if (cur.state === 'resolved') return fail('CONFLICT', 'That inspection is already finished.', 409);
  if (cur.state === 'in_progress') return json({ ok: true });

  await run(env, `UPDATE inspections SET state = 'in_progress', inspector_id = COALESCE(inspector_id, ?) WHERE id = ?`, session.userId, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'inspection.start', entityTable: 'inspections', entityId: id, before: { state: cur.state }, after: { state: 'in_progress' } });
  return json({ ok: true });
};
