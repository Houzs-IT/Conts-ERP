import { type Env, json, fail } from '../../../../_lib/db';
import { channexAirbnbListingDetails } from '../../../../_lib/channex';
import { importGate, airbnbChannelId, toSen } from '../../../../_lib/airbnbImport';
import { channexRefused } from '../../../../_lib/channexChannels';

/** GET /api/integrations/channex/airbnb-import/listing?listingId= — what one listing carries on Airbnb today:
 *  its standing nightly price, weekend price if it has one, and minimum nights. Read only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await importGate(request, env);
  if ('response' in gate) return gate.response;
  const listingId = new URL(request.url).searchParams.get('listingId')?.trim() ?? '';
  if (!listingId) return fail('VALIDATION', 'Which listing?', 422);
  const channelId = await airbnbChannelId(env);
  if (!channelId) return fail('NOT_CONNECTED', 'Sign in to Airbnb first.', 409);

  const r = await channexAirbnbListingDetails(env, channelId, listingId);
  if (!r.ok) return channexRefused('read the listing from Airbnb', r.status, r.body);
  const p = r.body?.data?.listing?.pricing_settings ?? {}, a = r.body?.data?.listing?.availability_rules ?? {};
  return json({
    listingId, currency: p.listing_currency ?? null,
    baseRate: toSen(p.default_daily_price), weekendRate: toSen(p.weekend_price),
    minStay: Math.min(60, Math.max(1, Math.round(Number(a.default_min_nights) || 1))),
  });
};
