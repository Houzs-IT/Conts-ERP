import { type Env } from '../../../../_lib/db';
import { hotelRooms, buildingFor } from '../../../../_lib/channexChannels';

/** POST /api/properties/:id/channels/lookup { ota, hotelId } — checks the Hotel ID with Channex and returns the rooms
 *  and rates that hotel has on the site, so staff can say which unit each room is. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await buildingFor(request, env, String(params.id));
  if ('response' in gate) return gate.response;
  return hotelRooms(env, await request.json<any>().catch(() => null));
};
