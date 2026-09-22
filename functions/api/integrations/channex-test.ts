import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { channexConfigured, channexProperty, channexRoomTypes, channexRatePlans, channexBookings, channexPushRate, channexPushAvailability, channexAvailability } from '../../_lib/channex';

/** Channex's own free staging demo property — not a real listing. Swap for real ids once a real
 *  unit is mapped in a later stage (see TODO.md, "one real listing"). */
const DEMO_PROPERTY_ID = 'ff674fc2-4a2e-45a6-b6c6-fc8df8675695';
const DEMO_ROOM_TYPE_ID = '19c476e7-8f78-4dd0-a273-8d230f4859fb';
const DEMO_RATE_PLAN_ID = '0d2c1da3-2656-4716-8a9e-cf0eccbf94d8';

/** GET /api/integrations/channex-test — proves the connection reads: property, room types, rate plans, bookings.
 *  Temporary, management-only, and only ever touches Channex's own demo property. Remove once the real integration lands. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can use this test.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'CHANNEX_API_KEY is not set on this environment.', 501);

  const [property, roomTypes, ratePlans, bookings] = await Promise.all([
    channexProperty(env, DEMO_PROPERTY_ID),
    channexRoomTypes(env, DEMO_PROPERTY_ID),
    channexRatePlans(env, DEMO_PROPERTY_ID),
    channexBookings(env, DEMO_PROPERTY_ID),
  ]);
  if (!property.ok) return fail('CHANNEX_ERROR', `Channex refused the read (status ${property.status}).`, 502);

  return json({
    connected: true,
    property: property.body?.data,
    roomTypes: roomTypes.body?.data,
    ratePlans: ratePlans.body?.data,
    bookings: (bookings.body?.data ?? []).map((b: any) => {
      const a = b.attributes ?? {};
      return {
        id: b.id, ota: a.ota_name, status: a.status, guestName: `${a.customer?.name ?? ''} ${a.customer?.surname ?? ''}`.trim(),
        arrival: a.arrival_date, departure: a.departure_date, amount: a.amount, currency: a.currency,
      };
    }),
  });
};

/** POST /api/integrations/channex-test — proves the connection writes: pushes a rate and an availability
 *  count for a near-future date range on the demo property, then reads availability back to confirm. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can use this test.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'CHANNEX_API_KEY is not set on this environment.', 501);

  const dateFrom = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const dateTo = new Date(Date.now() + 32 * 864e5).toISOString().slice(0, 10);
  const testRate = 100 + Math.floor(Math.random() * 100);
  const testAvailability = 1 + Math.floor(Math.random() * 4);

  const rateRes = await channexPushRate(env, { propertyId: DEMO_PROPERTY_ID, ratePlanId: DEMO_RATE_PLAN_ID, dateFrom, dateTo, rate: testRate });
  const availRes = await channexPushAvailability(env, { propertyId: DEMO_PROPERTY_ID, roomTypeId: DEMO_ROOM_TYPE_ID, dateFrom, dateTo, availability: testAvailability });
  if (!rateRes.ok || !availRes.ok) return fail('CHANNEX_ERROR', `Channex refused the write (rate ${rateRes.status}, availability ${availRes.status}).`, 502);

  const readBack = await channexAvailability(env, { propertyId: DEMO_PROPERTY_ID, roomTypeId: DEMO_ROOM_TYPE_ID, dateFrom, dateTo });
  const applied = readBack.body?.data?.[DEMO_ROOM_TYPE_ID]?.[dateFrom] === testAvailability;

  return json({ sent: { dateFrom, dateTo, rate: testRate, availability: testAvailability }, readBackMatches: applied, readBack: readBack.body?.data?.[DEMO_ROOM_TYPE_ID] });
};
