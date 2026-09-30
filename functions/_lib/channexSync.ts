import { type Env, one } from './db';
import { enqueueAvailability, enqueueRestrictions } from './channexQueue';

export interface ChannexMapping { propertyId: string; roomTypeId: string; ratePlanId: string }

export async function channexMappingFor(env: Env, unitId: string): Promise<ChannexMapping | null> {
  const u = await one<{ channex_property_id: string | null; channex_room_type_id: string | null; channex_rate_plan_id: string | null }>(
    env, 'SELECT channex_property_id, channex_room_type_id, channex_rate_plan_id FROM units WHERE id = ?', unitId);
  if (!u?.channex_property_id || !u.channex_room_type_id || !u.channex_rate_plan_id) return null;
  return { propertyId: u.channex_property_id, roomTypeId: u.channex_room_type_id, ratePlanId: u.channex_rate_plan_id };
}

/** Queues the nightly price for one date, or a date range, for the unit's Channex listing, if it has one.
 *  Nothing is sent from here: the outbox batches it with other waiting changes (channexQueue.ts). */
export function syncRateIfLinked(env: Env, unitId: string, dateFrom: string, rateSen: number, dateTo = dateFrom): Promise<void> {
  return enqueueRestrictions(env, unitId, dateFrom, dateTo, { rateSen });
}

/** Queues whether a unit can be booked over [dateFrom, dateToExclusive) — the check-out night itself is free.
 *  Called whenever a stay or block is created, cancelled or moved, so a channel never double-sells a
 *  unit that is already taken on our side. */
export function syncAvailabilityIfLinked(env: Env, unitId: string, dateFrom: string, dateToExclusive: string, available: boolean): Promise<void> {
  const lastNight = new Date(Date.parse(dateToExclusive) - 864e5).toISOString().slice(0, 10);
  return enqueueAvailability(env, unitId, dateFrom, lastNight, available ? 1 : 0);
}

/** Queues a minimum stay and/or stop sell for [dateFrom, dateTo] inclusive. */
export function syncRestrictionsIfLinked(env: Env, unitId: string, dateFrom: string, dateTo: string, r: { minStay?: number; stopSell?: boolean }): Promise<void> {
  return enqueueRestrictions(env, unitId, dateFrom, dateTo, r);
}
