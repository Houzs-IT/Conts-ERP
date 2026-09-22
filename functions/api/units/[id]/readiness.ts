import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { MASTER_ROLES } from '../../../_lib/properties';

/** The unit lifecycle states the operator sets by hand. Mirrors the unit_readiness check in the schema. */
export const READINESS = ['occupied', 'dirty', 'cleaning', 'inspection', 'ready', 'maintenance', 'blocked'] as const;

/** Roles that manage a unit's state: the master roles plus front-line operations staff. */
const CAN_SET = [...MASTER_ROLES, 'operations_staff'];

/** PATCH /api/units/:id/readiness { readiness } — move the unit to a state the operator picked. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!CAN_SET.includes(session.role)) return fail('FORBIDDEN', 'Only operations and management roles can change a unit state.', 403);

  const id = String(params.id);
  const b = await request.json<{ readiness?: string }>().catch(() => null);
  const next = b?.readiness;
  if (!next || !(READINESS as readonly string[]).includes(next)) {
    return fail('VALIDATION', 'Pick a valid unit state.', 422, { readiness: 'Pick a valid unit state.' });
  }

  const cur = await one<{ readiness: string }>(env, 'SELECT readiness FROM units WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  if (cur.readiness !== next) {
    await run(env, 'UPDATE units SET readiness = ?, updated_at = ? WHERE id = ?', next, nowIso(), id);
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'unit.readiness_change',
      entityTable: 'units', entityId: id, before: { readiness: cur.readiness }, after: { readiness: next },
    });
  }
  return json({ ok: true, readiness: next });
};
