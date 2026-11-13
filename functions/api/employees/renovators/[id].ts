import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hasRenovationDepartment } from '../../../_lib/hr';
import { followWorker } from '../../../_lib/fieldAccess';

const MANAGE = ['management'];

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include changing employee records.', 403);
  if (!(await hasRenovationDepartment(env))) return fail('NOT_MIGRATED', 'The Renovation department needs a database update (migration 0315) that has not been applied yet.', 503);

  const body = await request.json<Record<string, unknown>>().catch(() => null);
  if (typeof body?.isActive !== 'boolean') return fail('VALIDATION', 'Say whether to switch them on or off.', 422);
  const isActive = body.isActive;

  const id = String(params.id);
  const renovator = await one<{ is_active: number; user_id: string | null }>(env, 'SELECT is_active, user_id FROM renovators WHERE id = ?', id);
  if (!renovator) return fail('NOT_FOUND', 'That person is not in the Renovation department.', 404);

  const after: Record<string, unknown> = { isActive };
  await transaction(env, async tx => {
    await run(tx, 'UPDATE renovators SET is_active = ?, updated_at = ? WHERE id = ?', isActive ? 1 : 0, nowIso(), id);
    if (await followWorker(tx, renovator.user_id, isActive)) after.appLogin = isActive ? 'on' : 'off';
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'renovation.renovator_update', entityTable: 'renovators', entityId: id, before: { isActive: !!renovator.is_active }, after });
  });
  return json({ ok: true });
};
