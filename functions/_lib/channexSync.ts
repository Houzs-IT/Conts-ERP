import { type Env, one, audit } from './db';
import { channexConfigured, channexPushRate, channexPushAvailability } from './channex';

export interface ChannexMapping { propertyId: string; roomTypeId: string; ratePlanId: string }

export async function channexMappingFor(env: Env, unitId: string): Promise<ChannexMapping | null> {
  const u = await one<{ channex_property_id: string | null; channex_room_type_id: string | null; channex_rate_plan_id: string | null }>(
    env, 'SELECT channex_property_id, channex_room_type_id, channex_rate_plan_id FROM units WHERE id = ?', unitId);
  if (!u?.channex_property_id || !u.channex_room_type_id || !u.channex_rate_plan_id) return null;
  return { propertyId: u.channex_property_id, roomTypeId: u.channex_room_type_id, ratePlanId: u.channex_rate_plan_id };
}

/** Runs `body` and never lets it fail the caller, however it fails — a bad mapping lookup, a network
 *  error, Channex being down. A sync problem is recorded in the audit log, not thrown, since a channel
 *  being unreachable must never block the local save that triggered it. */
async function guarded(env: Env, unitId: string, action: string, after: Record<string, unknown>, body: () => Promise<{ ok: boolean; status: number } | null>) {
  try {
    const res = await body();
    if (res && !res.ok) await audit(env, { actorId: null, actorLabel: 'Channex sync', action, entityTable: 'units', entityId: unitId, after: { ...after, status: res.status } });
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action, entityTable: 'units', entityId: unitId, after: { ...after, error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }
}

/** Sends the nightly price for one date, or a date range, to the unit's Channex listing, if it has one. */
export function syncRateIfLinked(env: Env, unitId: string, dateFrom: string, rateSen: number, dateTo = dateFrom): Promise<void> {
  return guarded(env, unitId, 'channex.rate_push_failed', { dateFrom, dateTo }, async () => {
    if (!channexConfigured(env)) return null;
    const mapping = await channexMappingFor(env, unitId);
    if (!mapping) return null;
    return channexPushRate(env, { propertyId: mapping.propertyId, ratePlanId: mapping.ratePlanId, dateFrom, dateTo, rate: Math.round(rateSen) / 100 });
  });
}

/** Tells Channex whether a unit can be booked over [dateFrom, dateToExclusive) — the check-out night itself
 *  is free. Called whenever a stay or block is created, cancelled or moved, so a channel never double-sells
 *  a unit that is already taken on our side. */
export function syncAvailabilityIfLinked(env: Env, unitId: string, dateFrom: string, dateToExclusive: string, available: boolean): Promise<void> {
  return guarded(env, unitId, 'channex.availability_push_failed', { dateFrom, dateTo: dateToExclusive, available }, async () => {
    if (!channexConfigured(env)) return null;
    const mapping = await channexMappingFor(env, unitId);
    if (!mapping) return null;
    const lastNight = new Date(Date.parse(dateToExclusive) - 864e5).toISOString().slice(0, 10);
    if (lastNight < dateFrom) return null; // a same-day, zero-night range has nothing to push
    return channexPushAvailability(env, { propertyId: mapping.propertyId, roomTypeId: mapping.roomTypeId, dateFrom, dateTo: lastNight, availability: available ? 1 : 0 });
  });
}
