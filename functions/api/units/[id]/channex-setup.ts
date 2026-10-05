import { type Env, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { MASTER_ROLES } from '../../../_lib/properties';
import { channexConfigured } from '../../../_lib/channex';
import { setUpUnitInChannex } from '../../../_lib/channexSetup';

/** POST /api/units/:id/channex-setup — creates the unit's Channex listing and runs its first full sync. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501);

  const r = await setUpUnitInChannex(env, String(params.id), session);
  if (!r.ok) return fail(r.code, r.message, r.status, r.detail ? { detail: r.detail } : undefined);
  return json({ propertyId: r.propertyId, roomTypeId: r.roomTypeId, ratePlanId: r.ratePlanId, availabilitySent: r.availabilitySent }, 201);
};
