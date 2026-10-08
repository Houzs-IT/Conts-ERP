import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { channexCreateMapping, channexActivateChannel, channexLoadFutureReservations, channexDeleteMapping } from '../../../../_lib/channex';
import { linkedUnitFor, channexRefused } from '../../../../_lib/channexChannels';
import { ensureOtaRatePlans } from '../../../../_lib/channexSync';

/** POST /api/units/:id/channels/airbnb-map { channelId, listingId, listingTitle } — links one listing of the
 *  connected Airbnb account to this unit: maps it to the unit's rate plan (Airbnb confirms in about 30
 *  seconds), makes sure the account's channel is active, and loads the listing's existing bookings.
 *  If activation fails, the new mapping is removed again. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await linkedUnitFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;
  const { session, unit } = gate;

  const b = await request.json<any>().catch(() => null);
  const channelId = String(b?.channelId ?? ''), listingId = String(b?.listingId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) return fail('VALIDATION', 'The Airbnb connection is missing. Start again from the unit.', 422);
  if (!listingId) return fail('VALIDATION', 'Pick the Airbnb listing for this unit.', 422);
  if (await one(env, "SELECT 1 AS x FROM channex_channels WHERE unit_id = ? AND ota = 'airbnb'", unit.id)) return fail('CONFLICT', 'This unit is already connected to Airbnb.', 409);
  const taken = await one<{ unit_number: string }>(env, `SELECT u.unit_number FROM channex_channels c JOIN units u ON u.id = c.unit_id WHERE c.ota = 'airbnb' AND c.external_id = ?`, listingId);
  if (taken) return fail('CONFLICT', `That listing is already linked to ${taken.unit_number}.`, 409);

  // The listing is mapped to the unit's Airbnb rate plan, so it carries the Airbnb price.
  let ratePlanId: string | undefined;
  try { ratePlanId = (await ensureOtaRatePlans(env, unit.id))?.ratePlans.airbnb; }
  catch (e) { return fail('CHANNEX_REFUSED', e instanceof Error ? e.message : 'Channex refused the rate plan.', 502); }
  if (!ratePlanId) return fail('NOT_LINKED', 'Set this unit up in Channex first.', 409);

  const m = await channexCreateMapping(env, channelId, ratePlanId, { listing_id: listingId });
  const mappingId = m.body?.data?.id;
  if (!m.ok || !mappingId) return channexRefused('link the Airbnb listing', m.status, m.body);

  const act = await channexActivateChannel(env, channelId);
  if (!act.ok) { await channexDeleteMapping(env, channelId, mappingId); return channexRefused('switch the Airbnb connection on', act.status, act.body); }
  const load = await channexLoadFutureReservations(env, channelId, listingId);

  const id = crypto.randomUUID();
  await run(env, `INSERT INTO channex_channels (id, unit_id, ota, channex_channel_id, channex_mapping_id, external_id, title, created_by, created_at)
    VALUES (?, ?, 'airbnb', ?, ?, ?, ?, ?, ?)`, id, unit.id, channelId, mappingId, listingId, String(b?.listingTitle ?? `Airbnb listing ${listingId}`).slice(0, 200), session.userId, nowIso());
  // A unit sold on a booking site is listed: it counts in occupancy and the dashboard from here on.
  await run(env, 'UPDATE units SET is_listed = 1, updated_at = ? WHERE id = ? AND is_listed = 0', nowIso(), unit.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channel.connect', entityTable: 'units', entityId: unit.id, after: { ota: 'airbnb', listingId, channelId, mappingId, bookingsLoadRequested: load.ok } });
  return json({ id, bookingsLoadRequested: load.ok }, 201);
};
