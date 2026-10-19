import { type Env, one, run, json, fail, audit } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { channexDeactivateChannel, channexDeleteChannel, channexDeleteMapping, channexRemoveHotelRoom } from '../../../../_lib/channex';
import { OTA_LABEL, type Ota } from '../../../../_lib/channexChannels';

/** DELETE /api/units/:id/channels/:rowId — disconnects the unit from an OTA. Booking.com / Agoda: a hotel channel only
 *  this unit uses is switched off and deleted; one the building's other units share (migration 0128) keeps running and
 *  only this unit's room is taken off it. Airbnb: only this unit's listing mapping is removed; the account's channel
 *  stays for the other units on it. Bookings already received are kept. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403);

  const row = await one<{ id: string; ota: Ota; channex_channel_id: string; channex_mapping_id: string | null; external_id: string }>(env,
    'SELECT id, ota, channex_channel_id, channex_mapping_id, external_id FROM channex_channels WHERE id = ? AND unit_id = ?', String(params.rowId), String(params.id));
  if (!row) return fail('NOT_FOUND', 'That connection does not exist.', 404);

  if (row.ota === 'airbnb') {
    if (row.channex_mapping_id) {
      const r = await channexDeleteMapping(env, row.channex_channel_id, row.channex_mapping_id);
      if (!r.ok && r.status !== 404) return fail('CHANNEX_REFUSED', `Channex did not remove the Airbnb listing (${r.status}).`, 502);
    }
  } else if (await one(env, 'SELECT 1 AS x FROM channex_channels WHERE channex_channel_id = ? AND id <> ?', row.channex_channel_id, row.id)) {
    const plan = await one<{ p: string | null }>(env, `SELECT ${row.ota === 'agoda' ? 'channex_rate_plan_agoda' : 'channex_rate_plan_booking_com'} AS p FROM units WHERE id = ?`, String(params.id));
    const r = plan?.p ? await channexRemoveHotelRoom(env, row.channex_channel_id, plan.p) : null;
    // vocab-ok: OTA_LABEL is a code name; room is the Booking.com/Agoda word for what the unit is sold as
    if (!r || (!r.ok && r.status !== 404)) return fail('CHANNEX_REFUSED', `Channex did not take this unit's room off the ${OTA_LABEL[row.ota]} connection (${r?.status ?? 'no rate plan'}).`, 502);
  } else {
    const off = await channexDeactivateChannel(env, row.channex_channel_id);
    const del = await channexDeleteChannel(env, row.channex_channel_id);
    // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
    if (!del.ok && del.status !== 404) return fail('CHANNEX_REFUSED', `Channex did not remove the ${OTA_LABEL[row.ota]} connection (${del.status}${off.ok ? '' : ', and it could not be switched off'}).`, 502);
  }
  await run(env, 'DELETE FROM channex_channels WHERE id = ?', row.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channel.disconnect', entityTable: 'units', entityId: String(params.id), before: { ota: row.ota, externalId: row.external_id, channelId: row.channex_channel_id } });
  return json({ ok: true });
};
