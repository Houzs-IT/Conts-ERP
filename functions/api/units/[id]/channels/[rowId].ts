import { type Env, one, run, json, fail, audit } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { MASTER_ROLES } from '../../../../_lib/properties';
import { channexDeactivateChannel, channexDeleteChannel, channexDeleteMapping } from '../../../../_lib/channex';
import { OTA_LABEL, type Ota } from '../../../../_lib/channexChannels';

/** DELETE /api/units/:id/channels/:rowId — disconnects the unit from an OTA. Booking.com / Agoda: the
 *  unit's own channel is switched off and deleted. Airbnb: only this unit's listing mapping is removed;
 *  the account's channel stays for the other units on it. Bookings already received are kept. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403);

  const row = await one<{ id: string; ota: Ota; channex_channel_id: string; channex_mapping_id: string | null; external_id: string }>(env,
    'SELECT id, ota, channex_channel_id, channex_mapping_id, external_id FROM channex_channels WHERE id = ? AND unit_id = ?', String(params.rowId), String(params.id));
  if (!row) return fail('NOT_FOUND', 'That connection does not exist.', 404);

  if (row.ota === 'airbnb') {
    if (row.channex_mapping_id) {
      const r = await channexDeleteMapping(env, row.channex_channel_id, row.channex_mapping_id);
      if (!r.ok && r.status !== 404) return fail('CHANNEX_REFUSED', `Channex did not remove the Airbnb listing (${r.status}).`, 502);
    }
  } else {
    const off = await channexDeactivateChannel(env, row.channex_channel_id);
    const del = await channexDeleteChannel(env, row.channex_channel_id);
    if (!del.ok && del.status !== 404) return fail('CHANNEX_REFUSED', `Channex did not remove the ${OTA_LABEL[row.ota]} connection (${del.status}${off.ok ? '' : ', and it could not be switched off'}).`, 502);
  }
  await run(env, 'DELETE FROM channex_channels WHERE id = ?', row.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channel.disconnect', entityTable: 'units', entityId: String(params.id), before: { ota: row.ota, externalId: row.external_id, channelId: row.channex_channel_id } });
  return json({ ok: true });
};
