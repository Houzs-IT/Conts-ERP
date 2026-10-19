import { type Env } from '../../../../_lib/db';
import { linkedUnitFor, hotelRooms } from '../../../../_lib/channexChannels';

/** POST /api/units/:id/channels/lookup { ota, hotelId } — checks the Hotel ID with Channex and returns the
 *  rooms and rates that hotel has on the OTA, so staff can pick the one this unit is sold as. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await linkedUnitFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;
  return hotelRooms(env, await request.json<any>().catch(() => null));
};
