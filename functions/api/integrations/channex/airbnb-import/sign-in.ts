import { type Env, one, json, fail } from '../../../../_lib/db';
import { channexPropertyGroupId, channexAirbnbConnectionLink } from '../../../../_lib/channex';
import { importGate, airbnbChannelId } from '../../../../_lib/airbnbImport';
import { channexRefused } from '../../../../_lib/channexChannels';

/** POST /api/integrations/channex/airbnb-import/sign-in { reconnect? } — Airbnb's sign-in link for the whole
 *  account. Channex ties a new connection to a listing group, taken from any unit already set up in Channex.
 *  Airbnb sends the browser back to #/channex/airbnb-return with token "import". */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await importGate(request, env);
  if ('response' in gate) return gate.response;
  const b = await request.json<any>().catch(() => ({}));

  const existing = await airbnbChannelId(env);
  if (existing && !b?.reconnect) return json({ channelId: existing });
  const anchor = await one<{ channex_property_id: string }>(env, 'SELECT channex_property_id FROM units WHERE channex_property_id IS NOT NULL ORDER BY updated_at LIMIT 1');
  if (!anchor) return fail('NO_UNIT_IN_CHANNEX', 'Set one unit up in Channex first (open the unit, Channels card). The Airbnb sign-in needs it once.', 409);

  const groupId = await channexPropertyGroupId(env, anchor.channex_property_id);
  if (!groupId) return fail('CHANNEX_REFUSED', "Channex did not return the listing's group. Try again in a moment.", 502);
  const origin = new URL(request.url).origin;
  const link = await channexAirbnbConnectionLink(env, {
    groupId, propertyId: anchor.channex_property_id, token: 'import',
    redirectUri: `${origin}/#/channex/airbnb-return`, failureRedirectUri: `${origin}/#/channex/airbnb-return`,
    ...(existing ? { channelId: existing } : {}),
  });
  const url = link.body?.data?.attributes?.url;
  if (!link.ok || !url) return channexRefused('create the Airbnb sign-in link', link.status, link.body);
  return json({ url });
};
