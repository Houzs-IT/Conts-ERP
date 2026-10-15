import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { channexPropertyGroupId, channexCreateHotelChannelRooms, channexAddHotelRooms, channexActivateChannel, channexLoadFutureReservations, channexDeleteChannel, type HotelOta, type HotelRoomMap } from '../../../../_lib/channex';
import { channexRefused, buildingFor, OTA_LABEL, type ChannexBuilding } from '../../../../_lib/channexChannels';
import { ensureOtaRatePlans } from '../../../../_lib/channexSync';

interface BuildingUnit { id: string; unit_number: string; listing_name: string | null; max_guests: number; channex_property_id: string | null }

/** GET /api/properties/:id/channels — the building's Channex listing and, for each unit, whether it is set up in it
 *  and which Booking.com / Agoda room it is sold as. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Your account cannot see channel connections.', 403);
  const b = await one<ChannexBuilding>(env, 'SELECT id, name, channex_property_id FROM properties WHERE id = ?', String(params.id));
  if (!b) return fail('NOT_FOUND', 'That building does not exist.', 404);
  const units = await all<BuildingUnit>(env, 'SELECT id, unit_number, listing_name, max_guests, channex_property_id FROM units WHERE property_id = ? ORDER BY unit_number', b.id);
  const conns = await all<{ unit_id: string; ota: string; external_id: string; external_room: string | null; external_rate: string | null }>(env, `
    SELECT c.unit_id, c.ota, c.external_id, c.external_room, c.external_rate FROM channex_channels c JOIN units u ON u.id = c.unit_id
    WHERE u.property_id = ? AND c.ota IN ('booking_com','agoda')`, b.id);
  return json({
    channexListing: !!b.channex_property_id,
    units: units.map(u => ({
      id: u.id, unitNumber: u.unit_number, title: u.listing_name?.trim() || `${b.name} ${u.unit_number}`,
      // A unit set up before migration 0117 has a Channex property of its own and cannot share a hotel with the others.
      setUp: !!u.channex_property_id && u.channex_property_id === b.channex_property_id,
      ownListing: !!u.channex_property_id && u.channex_property_id !== b.channex_property_id,
      connections: conns.filter(c => c.unit_id === u.id).map(c => ({ ota: c.ota, hotelId: c.external_id, room: c.external_room, rate: c.external_rate })),
    })),
  });
};

/** POST /api/properties/:id/channels { ota, hotelId, pricingType?, rooms: [{ unitId, roomId, roomTitle, rateId, rateTitle, occupancy? }] }
 *  Connects a Booking.com or Agoda hotel to the building: each chosen room is mapped to one unit's rate plan for that
 *  site, in the building's Channex property. The first connection creates the Channex channel, switches it on and
 *  loads the bookings already on the site (if switching on fails the channel is deleted again); later ones add their
 *  rooms to that channel. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await buildingFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;
  const { session, building } = gate;

  const b = await request.json<any>().catch(() => null);
  const ota = b?.ota as HotelOta;
  if (ota !== 'booking_com' && ota !== 'agoda') return fail('VALIDATION', 'Pick Booking.com or Agoda.', 422);
  const hotelId = String(b?.hotelId ?? '').trim();
  if (!/^\d{3,12}$/.test(hotelId)) return fail('VALIDATION', 'Enter the Hotel ID (numbers only).', 422, { hotelId: 'Numbers only.' });
  const picks = (Array.isArray(b?.rooms) ? b.rooms : []).filter((r: any) => r?.unitId && r?.roomId && r?.rateId) as { unitId: string; roomId: string; roomTitle?: string; rateId: string; rateTitle?: string; occupancy?: number }[];
  // vocab-ok: Booking.com and Agoda call what a unit is sold as a room; these name both sides of the pairing
  if (!picks.length) return fail('VALIDATION', 'Pick a unit for at least one room.', 422);
  // vocab-ok: Booking.com and Agoda call what a unit is sold as a room; these name both sides of the pairing
  if (new Set(picks.map(p => p.unitId)).size !== picks.length) return fail('VALIDATION', 'Each unit can be one room only.', 422);
  // vocab-ok: Booking.com and Agoda call what a unit is sold as a room; these name both sides of the pairing
  if (new Set(picks.map(p => `${p.roomId}/${p.rateId}`)).size !== picks.length) return fail('VALIDATION', 'Each room can be one unit only.', 422);

  const units = await all<BuildingUnit>(env, `SELECT id, unit_number, listing_name, max_guests, channex_property_id FROM units WHERE property_id = ? AND id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    building.id, JSON.stringify(picks.map(p => p.unitId)));
  if (units.length !== picks.length) return fail('VALIDATION', 'One of the units is not in this building.', 422);
  const notReady = units.filter(u => u.channex_property_id !== building.channex_property_id);
  if (notReady.length) return fail('NOT_LINKED', `Set ${notReady.map(u => u.unit_number).join(', ')} up in Channex first (each unit's Channels card). A unit set up before building listings has a listing of its own and cannot share a hotel yet.`, 409);
  const already = await all<{ unit_number: string }>(env, `SELECT u.unit_number FROM channex_channels c JOIN units u ON u.id = c.unit_id
    WHERE c.ota = ? AND c.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, ota, JSON.stringify(picks.map(p => p.unitId)));
  // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
  if (already.length) return fail('CONFLICT', `${already.map(u => u.unit_number).join(', ')} already connected to ${OTA_LABEL[ota]}.`, 409);

  // Each room is mapped to its unit's rate plan for this site, so it carries this site's price.
  const rooms: HotelRoomMap[] = [];
  for (const p of picks) {
    const u = units.find(x => x.id === p.unitId)!;
    let ratePlanId: string | undefined;
    try { ratePlanId = (await ensureOtaRatePlans(env, u.id))?.ratePlans[ota]; }
    catch (e) { return fail('CHANNEX_REFUSED', e instanceof Error ? e.message : 'Channex refused the rate plan.', 502); }
    if (!ratePlanId) return fail('NOT_LINKED', `Set ${u.unit_number} up in Channex first.`, 409);
    const occupancy = Number.isInteger(p.occupancy) && p.occupancy! > 0 ? p.occupancy! : Math.max(1, Number(u.max_guests) || 2);
    rooms.push({ ratePlanId, roomCode: String(p.roomId), rateCode: String(p.rateId), occupancy, readonly: false });
  }
  const pricingType = String(b?.pricingType || 'Standard');

  const existing = await one<{ channex_channel_id: string }>(env, `SELECT c.channex_channel_id FROM channex_channels c JOIN units u ON u.id = c.unit_id
    WHERE u.property_id = ? AND c.ota = ? AND c.external_id = ? LIMIT 1`, building.id, ota, hotelId);
  let channelId: string, loadRequested = false;
  if (existing) {
    channelId = existing.channex_channel_id;
    const added = await channexAddHotelRooms(env, channelId, pricingType, rooms);
    // vocab-ok: OTA_LABEL is a code name; room is the Booking.com/Agoda word on the linking screen
    if (!added.ok) return channexRefused(`add the rooms to the ${OTA_LABEL[ota]} connection`, added.status, added.body);
  } else {
    const groupId = await channexPropertyGroupId(env, building.channex_property_id!);
    if (!groupId) return fail('CHANNEX_REFUSED', 'Channex did not return the listing\'s group. Try again in a moment.', 502);
    const created = await channexCreateHotelChannelRooms(env, {
      // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
      ota, groupId, propertyId: building.channex_property_id!, hotelId, title: `${building.name} · ${OTA_LABEL[ota]}`, pricingType, rooms,
    });
    const made = created.body?.data?.id;
    if (!created.ok || !made) {
      // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
      if (JSON.stringify(created.body ?? {}).includes('already exists')) return fail('HOTEL_TAKEN', `${OTA_LABEL[ota]} Hotel ID ${hotelId} is already connected to another listing in Channex. Disconnect it there first.`, 409);
      // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
      return channexRefused(`connect ${OTA_LABEL[ota]}`, created.status, created.body);
    }
    const act = await channexActivateChannel(env, made);
    // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
    if (!act.ok) { await channexDeleteChannel(env, made); return channexRefused(`switch the ${OTA_LABEL[ota]} connection on`, act.status, act.body); }
    channelId = made;
    loadRequested = (await channexLoadFutureReservations(env, channelId)).ok;
  }

  const now = nowIso();
  const rows = picks.map(p => ({ id: crypto.randomUUID(), unit_id: p.unitId, room: String(p.roomTitle ?? p.roomId).slice(0, 200), rate: String(p.rateTitle ?? p.rateId).slice(0, 200) }));
  await run(env, `INSERT INTO channex_channels (id, unit_id, ota, channex_channel_id, external_id, external_room, external_rate, title, created_by, created_at)
    SELECT x.id, x.unit_id, ?, ?, ?, x.room, x.rate, ?, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, room text, rate text)`,
    ota, channelId, hotelId, `${OTA_LABEL[ota]} hotel ${hotelId}`, session.userId, now, JSON.stringify(rows));
  // A unit sold on a booking site is listed: it counts in occupancy and the dashboard from here on.
  await run(env, `UPDATE units SET is_listed = 1, updated_at = ? WHERE is_listed = 0 AND id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, now, JSON.stringify(picks.map(p => p.unitId)));
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channel.connect_building', entityTable: 'properties', entityId: building.id,
    after: { ota, hotelId, channelId, addedToExisting: !!existing, rooms: picks.map(p => ({ unitId: p.unitId, room: p.roomId, rate: p.rateId })), bookingsLoadRequested: loadRequested } });
  return json({ channelId, connected: picks.length, addedToExisting: !!existing, bookingsLoadRequested: loadRequested }, 201);
};
