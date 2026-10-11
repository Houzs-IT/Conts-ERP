import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** PATCH /api/units/:id/channex-mapping
 *    { channexPropertyId, channexRoomTypeId, channexRatePlanId } — link the unit to a Channex listing.
 *    { clear: true } — unlink it.
 *  All three ids are required together; a unit is either fully mapped or not mapped at all. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403);

  const id = String(params.id);
  const unit = await one<{ id: string }>(env, 'SELECT id FROM units WHERE id = ?', id);
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);

  const b = await request.json<any>().catch(() => null);
  const now = nowIso();

  if (b?.clear) {
    await run(env, 'UPDATE units SET channex_property_id = NULL, channex_room_type_id = NULL, channex_rate_plan_id = NULL, updated_at = ? WHERE id = ?', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.channex_unmap', entityTable: 'units', entityId: id });
    return json({ ok: true });
  }

  const fields: Record<string, string> = {};
  // vocab-ok: Channex calls it a property; unit channel setup screen
  if (!b?.channexPropertyId?.trim()) fields.channexPropertyId = 'Enter the Channex property id.';
  if (!b?.channexRoomTypeId?.trim()) fields.channexRoomTypeId = 'Enter the Channex room type id.';
  if (!b?.channexRatePlanId?.trim()) fields.channexRatePlanId = 'Enter the Channex rate plan id.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'All three Channex ids are needed to link this unit.', 422, fields);

  await run(env, 'UPDATE units SET channex_property_id = ?, channex_room_type_id = ?, channex_rate_plan_id = ?, updated_at = ? WHERE id = ?',
    b.channexPropertyId.trim(), b.channexRoomTypeId.trim(), b.channexRatePlanId.trim(), now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.channex_map', entityTable: 'units', entityId: id, after: { propertyId: b.channexPropertyId, roomTypeId: b.channexRoomTypeId, ratePlanId: b.channexRatePlanId } });
  return json({ ok: true });
};
