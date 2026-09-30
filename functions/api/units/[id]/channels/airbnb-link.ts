import { type Env, one, json, fail } from '../../../../_lib/db';
import { channexPropertyGroupId, channexAirbnbConnectionLink } from '../../../../_lib/channex';
import { linkedUnitFor, channexRefused } from '../../../../_lib/channexChannels';

/** POST /api/units/:id/channels/airbnb-link { reconnect? } — starts connecting Airbnb for this unit.
 *  One Airbnb account is one Channex channel shared by every unit on it, so once any unit is connected
 *  the answer is that channel (pick another listing, no sign-in). Otherwise it returns Airbnb's sign-in
 *  link; after approval Airbnb sends the browser back to Conts (#/channex/airbnb-return) with the new
 *  channel id and this unit's id as the token. `reconnect` re-authorises the existing channel. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await linkedUnitFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;
  const { unit } = gate;
  const b = await request.json<any>().catch(() => ({}));

  const existing = await one<{ channex_channel_id: string }>(env, "SELECT channex_channel_id FROM channex_channels WHERE ota = 'airbnb' ORDER BY created_at LIMIT 1");
  if (existing && !b?.reconnect) return json({ channelId: existing.channex_channel_id });

  const groupId = await channexPropertyGroupId(env, unit.propertyId);
  if (!groupId) return fail('CHANNEX_REFUSED', 'Channex did not return the listing\'s group. Try again in a moment.', 502);
  const origin = new URL(request.url).origin;
  const link = await channexAirbnbConnectionLink(env, {
    groupId, propertyId: unit.propertyId, token: unit.id,
    redirectUri: `${origin}/#/channex/airbnb-return`, failureRedirectUri: `${origin}/#/channex/airbnb-return`,
    ...(existing && b?.reconnect ? { channelId: existing.channex_channel_id } : {}),
  });
  const url = link.body?.data?.attributes?.url;
  if (!link.ok || !url) return channexRefused('create the Airbnb sign-in link', link.status, link.body);
  return json({ url });
};
