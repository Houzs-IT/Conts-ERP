import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { channexPropertyGroupId, channexCreateHotelChannel, channexActivateChannel, channexLoadFutureReservations, channexDeleteChannel, type HotelOta } from '../../../../_lib/channex';
import { linkedUnitFor, channexRefused, OTA_LABEL } from '../../../../_lib/channexChannels';
import { ensureOtaRatePlans } from '../../../../_lib/channexSync';

/** GET /api/units/:id/channels — the unit's OTA connections made through Channex. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Your account cannot see channel connections.', 403);
  const rows = await all<{ id: string; ota: string; external_id: string; external_room: string | null; external_rate: string | null; title: string | null; created_at: string }>(env,
    'SELECT id, ota, external_id, external_room, external_rate, title, created_at FROM channex_channels WHERE unit_id = ? ORDER BY created_at', String(params.id));
  return json({ data: rows.map(r => ({ id: r.id, ota: r.ota, externalId: r.external_id, room: r.external_room, rate: r.external_rate, title: r.title, connectedAt: r.created_at })) });
};

/** POST /api/units/:id/channels { ota: 'booking_com'|'agoda', hotelId, roomId, roomTitle, rateId, rateTitle }
 *  Connects the unit to the chosen room and rate of a Booking.com or Agoda hotel: creates the Channex
 *  channel with the unit's rate plan mapped, activates it (Channex then pushes the unit's availability
 *  and prices), and loads the bookings that already exist on the OTA. If activation fails, the new
 *  channel is deleted again so nothing half-connected is left behind. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await linkedUnitFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;
  const { session, unit } = gate;

  const b = await request.json<any>().catch(() => null);
  const ota = b?.ota as HotelOta;
  if (ota !== 'booking_com' && ota !== 'agoda') return fail('VALIDATION', 'Pick Booking.com or Agoda.', 422);
  const hotelId = String(b?.hotelId ?? '').trim();
  if (!/^\d{3,12}$/.test(hotelId)) return fail('VALIDATION', 'Enter the Hotel ID (numbers only).', 422, { hotelId: 'Numbers only.' });
  if (!b?.roomId || !b?.rateId) return fail('VALIDATION', 'Pick the room and rate that match this unit.', 422);
  if (await one(env, 'SELECT 1 AS x FROM channex_channels WHERE unit_id = ? AND ota = ?', unit.id, ota)) return fail('CONFLICT', `This unit is already connected to ${OTA_LABEL[ota]}.`, 409);

  // The channel is mapped to this OTA's own rate plan, so it carries this OTA's price.
  let ratePlanId: string | undefined;
  try { ratePlanId = (await ensureOtaRatePlans(env, unit.id))?.ratePlans[ota]; }
  catch (e) { return fail('CHANNEX_REFUSED', e instanceof Error ? e.message : 'Channex refused the rate plan.', 502); }
  if (!ratePlanId) return fail('NOT_LINKED', 'Set this unit up in Channex first.', 409);

  const groupId = await channexPropertyGroupId(env, unit.propertyId);
  if (!groupId) return fail('CHANNEX_REFUSED', 'Channex did not return the listing\'s group. Try again in a moment.', 502);

  const occupancy = Number.isInteger(b.occupancy) && b.occupancy > 0 ? b.occupancy : unit.maxGuests;
  const created = await channexCreateHotelChannel(env, {
    ota, groupId, propertyId: unit.propertyId, ratePlanId, hotelId, title: `${unit.title} · ${OTA_LABEL[ota]}`,
    roomCode: String(b.roomId), rateCode: String(b.rateId), occupancy, pricingType: String(b.pricingType || 'Standard'), readonly: !!b.readonly,
  });
  const channelId = created.body?.data?.id;
  if (!created.ok || !channelId) {
    if (JSON.stringify(created.body ?? {}).includes('already exists')) return fail('HOTEL_TAKEN', `${OTA_LABEL[ota]} Hotel ID ${hotelId} is already connected to another listing in Channex. Disconnect it there first.`, 409);
    return channexRefused(`connect ${OTA_LABEL[ota]}`, created.status, created.body);
  }

  const act = await channexActivateChannel(env, channelId);
  if (!act.ok) { await channexDeleteChannel(env, channelId); return channexRefused(`switch the ${OTA_LABEL[ota]} connection on`, act.status, act.body); }
  const load = await channexLoadFutureReservations(env, channelId);

  const id = crypto.randomUUID();
  await run(env, `INSERT INTO channex_channels (id, unit_id, ota, channex_channel_id, external_id, external_room, external_rate, title, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, unit.id, ota, channelId, hotelId, String(b.roomTitle ?? b.roomId), String(b.rateTitle ?? b.rateId), `${OTA_LABEL[ota]} hotel ${hotelId}`, session.userId, nowIso());
  // A unit sold on a booking site is listed: it counts in occupancy and the dashboard from here on.
  await run(env, 'UPDATE units SET is_listed = 1, updated_at = ? WHERE id = ? AND is_listed = 0', nowIso(), unit.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channel.connect', entityTable: 'units', entityId: unit.id, after: { ota, hotelId, channelId, room: b.roomId, rate: b.rateId, bookingsLoadRequested: load.ok } });
  return json({ id, channelId, bookingsLoadRequested: load.ok }, 201);
};
