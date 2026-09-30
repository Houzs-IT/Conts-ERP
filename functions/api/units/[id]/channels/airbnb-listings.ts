import { type Env, all, json, fail } from '../../../../_lib/db';
import { channexAirbnbListings } from '../../../../_lib/channex';
import { linkedUnitFor, channexRefused } from '../../../../_lib/channexChannels';

/** GET /api/units/:id/channels/airbnb-listings?channelId= — the listings of the connected Airbnb account,
 *  marking the ones already linked to a unit so the same listing is never mapped twice. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await linkedUnitFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;
  const channelId = new URL(request.url).searchParams.get('channelId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) return fail('VALIDATION', 'The Airbnb connection is missing. Start again from the unit.', 422);

  const r = await channexAirbnbListings(env, channelId);
  if (!r.ok) return channexRefused('read the Airbnb listings', r.status, r.body);
  const taken = await all<{ external_id: string; unit_number: string }>(env, `
    SELECT c.external_id, u.unit_number FROM channex_channels c JOIN units u ON u.id = c.unit_id WHERE c.ota = 'airbnb' AND c.channex_channel_id = ?`, channelId);
  const takenBy = new Map(taken.map(t => [t.external_id, t.unit_number]));
  return json({
    channelId,
    listings: (r.body?.data?.listing_id_dictionary?.values ?? []).map(l => ({
      id: String(l.id), title: l.title, type: l.type, city: l.city, maxGuests: Math.max(0, ...(l.occupancies ?? [0])), linkedTo: takenBy.get(String(l.id)) ?? null,
    })),
  });
};
