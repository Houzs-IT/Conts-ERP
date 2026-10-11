import { type Env, json, fail } from '../../../../_lib/db';
import { channexTestConnection, channexMappingDetails, type HotelOta } from '../../../../_lib/channex';
import { linkedUnitFor, channexRefused, OTA_LABEL } from '../../../../_lib/channexChannels';

/** POST /api/units/:id/channels/lookup { ota, hotelId } — checks the Hotel ID with Channex and returns the
 *  rooms and rates that hotel has on the OTA, so staff can pick the one this unit is sold as. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await linkedUnitFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;

  const b = await request.json<any>().catch(() => null);
  const ota = b?.ota as HotelOta;
  if (ota !== 'booking_com' && ota !== 'agoda') return fail('VALIDATION', 'Pick Booking.com or Agoda.', 422);
  const hotelId = String(b?.hotelId ?? '').trim();
  if (!/^\d{3,12}$/.test(hotelId)) return fail('VALIDATION', 'Enter the Hotel ID (numbers only).', 422, { hotelId: 'Numbers only.' });

  const test = await channexTestConnection(env, ota, hotelId);
  // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
  if (!test.ok) return channexRefused(`check the ${OTA_LABEL[ota]} Hotel ID`, test.status, test.body);
  if (!test.body?.data?.success) {
    // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
    return fail('HOTEL_NOT_READY', `${OTA_LABEL[ota]} did not accept Hotel ID ${hotelId}. Check the number, and that Channex is chosen as the channel manager in the ${OTA_LABEL[ota]} extranet.`, 422,
      { detail: JSON.stringify(test.body?.data?.errors ?? {}).slice(0, 300) });
  }
  const details = await channexMappingDetails(env, ota, hotelId);
  // vocab-ok: OTA_LABEL is a code name; room is the Booking.com/Agoda word on the linking screen
  if (!details.ok) return channexRefused(`read the ${OTA_LABEL[ota]} rooms`, details.status, details.body);
  const d = details.body?.data ?? {};
  return json({
    pricingType: d.pricing_type ?? 'Standard',
    rooms: (d.rooms ?? []).map(r => ({
      id: String(r.id), title: r.title,
      rates: (r.rates ?? []).map(x => ({ id: String(x.id), title: x.title, maxPersons: x.max_persons ?? null, pricing: x.pricing ?? d.pricing_type ?? 'Standard', readonly: !!x.readonly })),
    })),
  });
};
