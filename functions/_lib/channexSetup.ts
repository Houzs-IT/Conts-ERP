import { type Env, one, run, audit, nowIso } from './db';
import { channexCreateProperty, channexCreateRoomType, channexCreateRatePlan, channexDeleteProperty } from './channex';
import { queueFullSync, flushChannexQueue } from './channexQueue';
import { ensureOtaRatePlans } from './channexSync';

export type ChannexSetupResult =
  | { ok: true; propertyId: string; roomTypeId: string; ratePlanId: string; availabilitySent: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' | 'NO_BASE_PRICE' | 'CHANNEX_REFUSED'; message: string; status: number; detail?: string };

/** Creates a unit's Channex listing (property, room type, rate plan), links it, then runs a full sync
 *  (500 days of availability, prices and restrictions). If Channex refuses any creation step, the property
 *  made so far is deleted again so no half-built listing is left behind. */
export async function setUpUnitInChannex(env: Env, unitId: string, actor: { userId: string; fullName: string }): Promise<ChannexSetupResult> {
  const u = await one<{ id: string; unit_number: string; listing_name: string | null; max_guests: number; base_rate: number; channex_property_id: string | null; property_name: string; city: string; state: string; address_line: string; address: string | null }>(env, `
    SELECT u.id, u.unit_number, u.listing_name, u.max_guests, u.base_rate, u.channex_property_id, u.address,
           p.name AS property_name, p.city, p.state, p.address_line
    FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, unitId);
  if (!u) return { ok: false, code: 'NOT_FOUND', message: 'That unit does not exist.', status: 404 };
  if (u.channex_property_id) return { ok: false, code: 'CONFLICT', message: 'This unit is already set up in Channex.', status: 409 };
  // Nights without their own price go to Channex at the base price, and Channex discards a zero price.
  if (!(Number(u.base_rate) > 0)) return { ok: false, code: 'NO_BASE_PRICE', message: "Set this unit's base price first (Performance, then Pricing). Channex needs a price for every night.", status: 409 };

  const title = u.listing_name?.trim() || `${u.property_name} ${u.unit_number}`;
  const guests = Math.max(1, Number(u.max_guests) || 2);
  const rate = Number(u.base_rate) / 100;
  const refused = (step: string, status: number, body: unknown): ChannexSetupResult =>
    ({ ok: false, code: 'CHANNEX_REFUSED', message: `Channex refused to create the ${step} (${status}). Nothing was set up.`, status: 502, detail: JSON.stringify(body ?? {}).slice(0, 300) });

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
    propertyId, roomTypeId, ratePlanId, nowIso(), unitId);
  await audit(env, { actorId: actor.userId, actorLabel: actor.fullName, action: 'unit.channex_setup', entityTable: 'units', entityId: unitId, after: { propertyId, roomTypeId, ratePlanId } });

  // The first full sync goes through the outbox like every other update. It is not allowed to undo the
  // link: if it cannot go now it stays queued and is retried.
  let availabilitySent = false;
  try {
    await ensureOtaRatePlans(env, unitId);   // one rate plan per booking site, each at its own price
    await queueFullSync(env, [unitId]);
    const sent = await flushChannexQueue(env, { fullSync: true });
    const good = (s?: number) => (s ?? 0) >= 200 && (s ?? 0) < 300;
    availabilitySent = good(sent.availability?.status) && good(sent.restrictions?.status);
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.initial_push_failed', entityTable: 'units', entityId: unitId, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }
  return { ok: true, propertyId, roomTypeId, ratePlanId, availabilitySent };
}
