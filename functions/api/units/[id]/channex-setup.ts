import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { channexConfigured, channexCreateProperty, channexCreateRoomType, channexCreateRatePlan, channexDeleteProperty } from '../../../_lib/channex';
import { queueFullSync, flushChannexQueue } from '../../../_lib/channexQueue';
import { ensureOtaRatePlans } from '../../../_lib/channexSync';

/** POST /api/units/:id/channex-setup — creates the unit's Channex listing (property, room type, rate plan),
 *  links it, then runs a full sync (500 days of availability, prices and restrictions). If Channex refuses any creation step,
 *  the property made so far is deleted again so no half-built listing is left behind. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501);

  const id = String(params.id);
  const u = await one<{ id: string; unit_number: string; listing_name: string | null; max_guests: number; base_rate: number; channex_property_id: string | null; property_name: string; city: string; state: string; address_line: string; address: string | null }>(env, `
    SELECT u.id, u.unit_number, u.listing_name, u.max_guests, u.base_rate, u.channex_property_id, u.address,
           p.name AS property_name, p.city, p.state, p.address_line
    FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, id);
  if (!u) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  if (u.channex_property_id) return fail('CONFLICT', 'This unit is already set up in Channex.', 409);
  // Nights without their own price go to Channex at the base price, and Channex discards a zero price.
  if (!(Number(u.base_rate) > 0)) return fail('NO_BASE_PRICE', "Set this unit's base price first (Performance, then Pricing). Channex needs a price for every night.", 409);

  const title = u.listing_name?.trim() || `${u.property_name} ${u.unit_number}`;
  const guests = Math.max(1, Number(u.max_guests) || 2);
  const rate = Number(u.base_rate) / 100;
  const refused = (step: string, status: number, body: unknown) => {
    const detail = JSON.stringify(body ?? {}).slice(0, 300);
    return fail('CHANNEX_REFUSED', `Channex refused to create the ${step} (${status}). Nothing was set up.`, 502, { detail });
  };

  const prop = await channexCreateProperty(env, { title, city: u.city, state: u.state, address: u.address || u.address_line });
  const propertyId = prop.body?.data?.id;
  if (!prop.ok || !propertyId) return refused('listing', prop.status, prop.body);

  const room = await channexCreateRoomType(env, { propertyId, title, maxGuests: guests });
  const roomTypeId = room.body?.data?.id;
  if (!room.ok || !roomTypeId) { await channexDeleteProperty(env, propertyId); return refused('room type', room.status, room.body); }

  const plan = await channexCreateRatePlan(env, { propertyId, roomTypeId, maxGuests: guests, rate });
  const ratePlanId = plan.body?.data?.id;
  if (!plan.ok || !ratePlanId) { await channexDeleteProperty(env, propertyId); return refused('rate plan', plan.status, plan.body); }

  await run(env, 'UPDATE units SET channex_property_id = ?, channex_room_type_id = ?, channex_rate_plan_id = ?, updated_at = ? WHERE id = ?',
    propertyId, roomTypeId, ratePlanId, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.channex_setup', entityTable: 'units', entityId: id, after: { propertyId, roomTypeId, ratePlanId } });

  // The first full sync goes through the outbox like every other update. It is not allowed to undo the
  // link: if it cannot go now it stays queued and is retried.
  let ariOk = false;
  try {
    await ensureOtaRatePlans(env, id);   // one rate plan per booking site, each at its own price
    await queueFullSync(env, [id]);
    const sent = await flushChannexQueue(env, { fullSync: true });
    ariOk = (sent.availability?.status ?? 0) < 300 && (sent.availability?.status ?? 0) >= 200 && (sent.restrictions?.status ?? 0) >= 200 && (sent.restrictions?.status ?? 0) < 300;
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.initial_push_failed', entityTable: 'units', entityId: id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }

  return json({ propertyId, roomTypeId, ratePlanId, availabilitySent: ariOk }, 201);
};
