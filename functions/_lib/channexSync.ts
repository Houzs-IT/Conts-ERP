import { type Env, one, all, run, mytToday } from './db';
import { enqueueAvailability, enqueueRestrictions } from './channexQueue';
import { channexCreateRatePlan } from './channex';
import { OTA_CHANNELS, standardRate, type SalesChannel } from './channelPrice';
import { purposeOf } from './unitPurpose';

/** A unit's Channex listing. `ratePlans` holds one rate plan per sales channel that has one: 'web' is the
 *  direct plan (always present on a linked unit); each OTA gets its own so it can carry its own price. */
export interface ChannexMapping { propertyId: string; roomTypeId: string; ratePlanId: string; ratePlans: Partial<Record<SalesChannel, string>> }

const OTA_PLAN_TITLE: Record<typeof OTA_CHANNELS[number], string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda' };
const OTA_PLAN_COLUMN: Record<typeof OTA_CHANNELS[number], string> = { airbnb: 'channex_rate_plan_airbnb', booking_com: 'channex_rate_plan_booking_com', agoda: 'channex_rate_plan_agoda' };

export async function channexMappingFor(env: Env, unitId: string): Promise<ChannexMapping | null> {
  const u = await one<{ channex_property_id: string | null; channex_room_type_id: string | null; channex_rate_plan_id: string | null; channex_rate_plan_airbnb: string | null; channex_rate_plan_booking_com: string | null; channex_rate_plan_agoda: string | null }>(
    env, 'SELECT channex_property_id, channex_room_type_id, channex_rate_plan_id, channex_rate_plan_airbnb, channex_rate_plan_booking_com, channex_rate_plan_agoda FROM units WHERE id = ?', unitId);
  if (!u?.channex_property_id || !u.channex_room_type_id || !u.channex_rate_plan_id) return null;
  // A showroom or warehouse is never sent to the channels, whatever ids it carries (owner, 17 Oct 2026). Every
  // enqueue and rate-plan path goes through here.
  if ((await purposeOf(env, unitId)) !== 'rental') return null;
  return {
    propertyId: u.channex_property_id, roomTypeId: u.channex_room_type_id, ratePlanId: u.channex_rate_plan_id,
    ratePlans: {
      web: u.channex_rate_plan_id,
      ...(u.channex_rate_plan_airbnb ? { airbnb: u.channex_rate_plan_airbnb } : {}),
      ...(u.channex_rate_plan_booking_com ? { booking_com: u.channex_rate_plan_booking_com } : {}),
      ...(u.channex_rate_plan_agoda ? { agoda: u.channex_rate_plan_agoda } : {}),
    },
  };
}

/** Makes sure a linked unit has its Airbnb, Booking.com and Agoda rate plans in Channex, creating any that
 *  are missing at that channel's standard price. Returns the mapping, or null if the unit is not linked.
 *  Throws if Channex refuses a creation, so the caller can report it. */
export async function ensureOtaRatePlans(env: Env, unitId: string): Promise<ChannexMapping | null> {
  const m = await channexMappingFor(env, unitId);
  if (!m) return null;
  const missing = OTA_CHANNELS.filter(c => !m.ratePlans[c]);
  if (!missing.length) return m;

  const u = await one<{ base_rate: number; weekend_rate: number | null; max_guests: number }>(env, 'SELECT base_rate, weekend_rate, max_guests FROM units WHERE id = ?', unitId);
  const uplifts = await all<{ channel: string; uplift: number }>(env, 'SELECT channel, uplift FROM channel_uplifts WHERE unit_id = ?', unitId);
  const today = mytToday();
  for (const channel of missing) {
    const res = await channexCreateRatePlan(env, {
      propertyId: m.propertyId, roomTypeId: m.roomTypeId, maxGuests: Math.max(1, Number(u?.max_guests) || 2),
      rate: Math.max(1, standardRate(channel, Number(u?.base_rate ?? 0), u?.weekend_rate, uplifts.find(x => x.channel === channel)?.uplift, today)) / 100, title: OTA_PLAN_TITLE[channel],
    });
    const id = res.body?.data?.id;
    if (!res.ok || !id) throw new Error(`Channex refused the ${OTA_PLAN_TITLE[channel]} rate plan (${res.status})`);
    await run(env, `UPDATE units SET ${OTA_PLAN_COLUMN[channel]} = ? WHERE id = ?`, id, unitId);
    m.ratePlans[channel] = id;
  }
  return m;
}

/** Queues a channel's nightly price for one date, or a date range, for the unit's Channex listing, if it has
 *  that channel's rate plan. Nothing is sent from here: the outbox batches it (channexQueue.ts). */
export function syncRateIfLinked(env: Env, unitId: string, dateFrom: string, rateSen: number, dateTo = dateFrom, channel: SalesChannel = 'web'): Promise<void> {
  return enqueueRestrictions(env, unitId, dateFrom, dateTo, { rateSen }, channel);
}

/** Queues whether a unit can be booked over [dateFrom, dateToExclusive) — the check-out night itself is free.
 *  Called whenever a stay or block is created, cancelled or moved, so a channel never double-sells a
 *  unit that is already taken on our side. */
export function syncAvailabilityIfLinked(env: Env, unitId: string, dateFrom: string, dateToExclusive: string, available: boolean): Promise<void> {
  const lastNight = new Date(Date.parse(dateToExclusive) - 864e5).toISOString().slice(0, 10);
  return enqueueAvailability(env, unitId, dateFrom, lastNight, available ? 1 : 0);
}

/** Queues a minimum stay and/or stop sell for [dateFrom, dateTo] inclusive, on every rate plan the unit has. */
export function syncRestrictionsIfLinked(env: Env, unitId: string, dateFrom: string, dateTo: string, r: { minStay?: number; stopSell?: boolean }): Promise<void> {
  return enqueueRestrictions(env, unitId, dateFrom, dateTo, r);
}
