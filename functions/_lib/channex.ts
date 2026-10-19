import type { Env } from './db';

/** Channex server for this environment, from wrangler.toml: staging.channex.io on preview, app.channex.io
 *  on production. Falls back to staging so a missing setting can never touch real listings. */
export const channexServer = (env: Env) => (env.CHANNEX_BASE_URL || 'https://staging.channex.io').replace(/\/+$/, '');

async function channexFetch<T = unknown>(env: Env, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T | null }> {
  if (!env.CHANNEX_API_KEY) return { ok: false, status: 0, body: null };
  const res = await fetch(channexServer(env) + '/api/v1' + path, {
    ...init,
    headers: { 'user-api-key': env.CHANNEX_API_KEY, accept: 'application/json', 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: T | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, body };
}

export const channexConfigured = (env: Env) => !!env.CHANNEX_API_KEY;

/** Only OTAs the owner has actually connected map to a channel. Bookings, messages and reviews
 *  each spell the OTA's name differently ("Airbnb" vs "AirBNB" vs "BookingCom"), so this
 *  normalises before matching. An OTA Channex sends that isn't listed here (Expedia, say — never
 *  connected) comes back null, and callers skip it rather than guessing at a channel for it. */
const CHANNEL_BY_OTA_KEY: Record<string, string> = { airbnb: 'airbnb', bookingcom: 'booking_com', agoda: 'agoda' };
export function channexChannelFor(otaName: string | null | undefined): string | null {
  return CHANNEL_BY_OTA_KEY[String(otaName ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null;
}

export const channexProperty = (env: Env, propertyId: string) => channexFetch<{ data: any }>(env, `/properties/${propertyId}`);
export const channexRoomTypes = (env: Env, propertyId: string) => channexFetch<{ data: any[] }>(env, `/room_types?filter[property_id]=${propertyId}`);
export const channexRatePlans = (env: Env, propertyId: string) => channexFetch<{ data: any[] }>(env, `/rate_plans?filter[property_id]=${propertyId}`);
export const channexBookings = (env: Env, propertyId: string) => channexFetch<{ data: any[] }>(env, `/bookings?filter[property_id]=${propertyId}`);

/** Bookings we have not yet acknowledged — the recommended way to pull bookings in, since a
 *  webhook payload only carries an id and delivery order is not guaranteed. */
export const channexBookingFeed = (env: Env) => channexFetch<{ data: any[] }>(env, '/booking_revisions/feed?order[inserted_at]=asc');

/** Marks a booking revision as processed so it drops out of the feed for good. Only call this
 *  once it has actually been turned into (or applied to) a reservation — never before. */
export const channexAckBookingRevision = (env: Env, revisionId: string) => channexFetch(env, `/booking_revisions/${revisionId}/ack`, { method: 'POST' });

export const channexListWebhooks = (env: Env) => channexFetch<{ data: any[] }>(env, '/webhooks');

/** Everything this app knows how to pull in. Kept as one shared constant so registering and
 *  checking a webhook can never drift apart. */
export const CHANNEX_EVENT_MASK = 'booking;message;review';

/** Registers one account-wide webhook covering bookings, messages and reviews. Channex sends the
 *  secret back as X-Channex-Webhook-Secret on every call, which is how the receiving endpoint
 *  tells a real Channex call apart from anyone else who finds the URL. */
export function channexCreateWebhook(env: Env, p: { callbackUrl: string; secret: string }) {
  return channexFetch<{ data: { id: string } }>(env, '/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      webhook: {
        callback_url: p.callbackUrl, event_mask: CHANNEX_EVENT_MASK, property_id: null, is_global: true,
        is_active: true, send_data: true, headers: { 'X-Channex-Webhook-Secret': p.secret },
      },
    }),
  });
}

/** Brings an already-registered webhook's event mask up to date — used when a webhook was set up
 *  before a later stage added new event types it should also cover. */
export function channexUpdateWebhookMask(env: Env, webhookId: string, p: { callbackUrl: string; secret: string }) {
  return channexFetch(env, `/webhooks/${webhookId}`, {
    method: 'PUT',
    body: JSON.stringify({
      webhook: {
        callback_url: p.callbackUrl, event_mask: CHANNEX_EVENT_MASK, property_id: null, is_global: true,
        is_active: true, send_data: true, headers: { 'X-Channex-Webhook-Secret': p.secret },
      },
    }),
  });
}

/** Airbnb, Booking.com and Expedia only — Channex has no Messages API for Agoda, so an Agoda
 *  thread stays local-only (its replies just never leave this app). */
export const channexMessageThreads = (env: Env) => channexFetch<{ data: any[] }>(env, '/message_threads');
export const channexThreadMessages = (env: Env, threadId: string) => channexFetch<{ data: any[] }>(env, `/message_threads/${threadId}/messages`);
export function channexSendMessage(env: Env, threadId: string, body: string) {
  return channexFetch<{ data: { id: string } }>(env, `/message_threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message: { message: body } }),
  });
}

/** Reviews Application: same three OTAs as messages. Scores are out of 10 — divide by 2 for our
 *  0-5 scale. */
export const channexReviews = (env: Env) => channexFetch<{ data: any[] }>(env, '/reviews');
export function channexReplyToReview(env: Env, reviewId: string, reply: string) {
  return channexFetch(env, `/reviews/${reviewId}/reply`, { method: 'POST', body: JSON.stringify({ reply: { reply } }) });
}

/** Whole-currency-unit rate (e.g. 150.00), not sen — confirmed against the demo property. */
/** One ARI call carrying every value in the batch — the only way the outbox (channexQueue.ts) talks to Channex. */
export function channexSendAri(env: Env, kind: 'availability' | 'restrictions', values: Record<string, unknown>[]) {
  return channexFetch<{ data?: { id: string; type: string }[] }>(env, `/${kind}`, { method: 'POST', body: JSON.stringify({ values }) });
}


/* ---- Setting up a unit as a Channex listing (stage 5) ---- */

/** A building's Channex property (one per unit before migration 0128), typed as an apartment: a vacation rental is billed per unit, while
 *  Channex's default type (hotel) is billed as a hotel. Automatic availability updates stay on for new
 *  OTA bookings only, as Channex advises for a PMS that sends its own availability. */
export function channexCreateProperty(env: Env, p: { title: string; city: string; state: string; address: string }) {
  return channexFetch<{ data: { id: string } }>(env, '/properties', {
    method: 'POST',
    body: JSON.stringify({ property: {
      title: p.title, currency: 'MYR', property_type: 'apartment', timezone: 'Asia/Kuala_Lumpur', country: 'MY',
      city: p.city || null, state: p.state || null, address: p.address || null,
      settings: { allow_availability_autoupdate_on_confirmation: true, allow_availability_autoupdate_on_modification: false, allow_availability_autoupdate_on_cancellation: false, min_stay_type: 'both' },
    } }),
  });
}

export function channexCreateRoomType(env: Env, p: { propertyId: string; title: string; maxGuests: number }) {
  return channexFetch<{ data: { id: string } }>(env, '/room_types', {
    method: 'POST',
    body: JSON.stringify({ room_type: {
      property_id: p.propertyId, title: p.title, count_of_rooms: 1, occ_adults: p.maxGuests, occ_children: 0, occ_infants: 0,
      default_occupancy: p.maxGuests, room_kind: 'room', facilities: [],
    } }),
  });
}

export function channexCreateRatePlan(env: Env, p: { propertyId: string; roomTypeId: string; maxGuests: number; rate: number; title?: string }) {
  return channexFetch<{ data: { id: string } }>(env, '/rate_plans', {
    method: 'POST',
    body: JSON.stringify({ rate_plan: {
      title: p.title ?? 'Direct', property_id: p.propertyId, room_type_id: p.roomTypeId, currency: 'MYR',
      sell_mode: 'per_room', rate_mode: 'manual', options: [{ occupancy: p.maxGuests, is_primary: true, rate: p.rate.toFixed(2) }],   // decimal text: a bare number means minor units
    } }),
  });
}

export const channexDeleteProperty = (env: Env, propertyId: string) => channexFetch(env, `/properties/${propertyId}`, { method: 'DELETE' });
export const channexDeleteRoomType = (env: Env, roomTypeId: string) => channexFetch(env, `/room_types/${roomTypeId}`, { method: 'DELETE' });

/* ---- Channel connections through the Channel API (replaces the deprecated embedded /channels screen) ---- */

/** Channex adapter codes for the OTAs Conts connects. */
export const OTA_ADAPTER = { booking_com: 'BookingCom', agoda: 'Agoda' } as const;
export type HotelOta = keyof typeof OTA_ADAPTER;

/** The group a property belongs to (every property has at least one); new channels are created in it. */
export async function channexPropertyGroupId(env: Env, propertyId: string): Promise<string | null> {
  const r = await channexFetch<{ data: any }>(env, `/properties/${propertyId}`);
  const g = r.body?.data?.relationships?.groups?.data ?? r.body?.data?.attributes?.groups;
  return Array.isArray(g) && g[0]?.id ? String(g[0].id) : null;
}

export const channexTestConnection = (env: Env, ota: HotelOta, hotelId: string) =>
  channexFetch<{ data?: { success: boolean; errors: unknown } }>(env, '/channels/test_connection', { method: 'POST', body: JSON.stringify({ channel: OTA_ADAPTER[ota], settings: { hotel_id: hotelId } }) });

/** The rooms and rates the hotel exposes on the OTA side, to be matched to the unit. */
export const channexMappingDetails = (env: Env, ota: HotelOta, hotelId: string) =>
  channexFetch<{ data?: { pricing_type?: string; rooms?: { id: number | string; title: string; rates: { id: number | string; title: string; max_persons?: number; occupancies?: number[]; pricing?: string; readonly?: boolean }[] }[] } }>(
    env, '/channels/mapping_details', { method: 'POST', body: JSON.stringify({ channel: OTA_ADAPTER[ota], settings: { hotel_id: hotelId } }) });

/** Creates the connection (always created inactive by Channex) with the unit's one rate plan mapped. */
export function channexCreateHotelChannel(env: Env, p: { ota: HotelOta; groupId: string; propertyId: string; ratePlanId: string; hotelId: string; title: string; roomCode: string; rateCode: string; occupancy: number; pricingType: string; readonly: boolean }) {
  return channexCreateHotelChannelRooms(env, { ...p, rooms: [{ ratePlanId: p.ratePlanId, roomCode: p.roomCode, rateCode: p.rateCode, occupancy: p.occupancy, readonly: p.readonly }] });
}

/** One hotel room and rate on the OTA, mapped to a unit's rate plan in Channex. */
export interface HotelRoomMap { ratePlanId: string; roomCode: string; rateCode: string; occupancy: number; readonly: boolean }
const hotelRatePlan = (r: HotelRoomMap, pricingType: string) =>
  ({ rate_plan_id: r.ratePlanId, settings: { room_type_code: r.roomCode, rate_plan_code: r.rateCode, occupancy: r.occupancy, pricing_type: pricingType, primary_occ: true, readonly: r.readonly } });

/** A Booking.com or Agoda hotel connected to one Channex property, with each of its rooms mapped to one unit. */
export function channexCreateHotelChannelRooms(env: Env, p: { ota: HotelOta; groupId: string; propertyId: string; hotelId: string; title: string; pricingType: string; rooms: HotelRoomMap[] }) {
  return channexFetch<{ data?: { id: string } }>(env, '/channels', {
    method: 'POST',
    body: JSON.stringify({ channel: {
      channel: OTA_ADAPTER[p.ota], group_id: p.groupId, title: p.title, properties: [p.propertyId], settings: { hotel_id: p.hotelId },
      rate_plans: p.rooms.map(r => hotelRatePlan(r, p.pricingType)),
    } }),
  });
}

/** Adds rooms to a hotel channel that already exists: Channex replaces the whole list, so the current one is sent with them. */
export async function channexAddHotelRooms(env: Env, channelId: string, pricingType: string, rooms: HotelRoomMap[]) {
  const cur = await channexFetch<{ data?: { attributes?: { rate_plans?: { rate_plan_id: string; settings: Record<string, unknown> }[] } } }>(env, `/channels/${channelId}`);
  if (!cur.ok) return cur;
  const kept = (cur.body?.data?.attributes?.rate_plans ?? []).map(r => ({ rate_plan_id: r.rate_plan_id, settings: r.settings }));
  return channexFetch(env, `/channels/${channelId}`, { method: 'PUT', body: JSON.stringify({ channel: { rate_plans: [...kept, ...rooms.map(r => hotelRatePlan(r, pricingType))] } }) });
}

/** Takes one unit's room off a hotel channel that other units of the building still use. */
export async function channexRemoveHotelRoom(env: Env, channelId: string, ratePlanId: string) {
  const cur = await channexFetch<{ data?: { attributes?: { rate_plans?: { rate_plan_id: string; settings: Record<string, unknown> }[] } } }>(env, `/channels/${channelId}`);
  if (!cur.ok) return cur;
  const kept = (cur.body?.data?.attributes?.rate_plans ?? []).filter(r => r.rate_plan_id !== ratePlanId).map(r => ({ rate_plan_id: r.rate_plan_id, settings: r.settings }));
  return channexFetch(env, `/channels/${channelId}`, { method: 'PUT', body: JSON.stringify({ channel: { rate_plans: kept } }) });
}

/** A channel can only sell rate plans of the Channex properties it lists. One Airbnb account is one channel for every
 *  unit on it, and since migration 0128 each building is its own property, so a unit in a building the channel does
 *  not list yet adds that building's property to it. */
export async function channexEnsureChannelProperty(env: Env, channelId: string, propertyId: string) {
  const cur = await channexFetch<{ data?: { attributes?: { properties?: string[] }; relationships?: { properties?: { data?: { id: string }[] } } } }>(env, `/channels/${channelId}`);
  if (!cur.ok) return cur;
  const listed = cur.body?.data?.attributes?.properties ?? (cur.body?.data?.relationships?.properties?.data ?? []).map(p => p.id);
  if (listed.includes(propertyId)) return cur;
  return channexFetch(env, `/channels/${channelId}`, { method: 'PUT', body: JSON.stringify({ channel: { properties: [...listed, propertyId] } }) });
}

export const channexActivateChannel = (env: Env, channelId: string) => channexFetch(env, `/channels/${channelId}/activate`, { method: 'POST' });
export const channexDeactivateChannel = (env: Env, channelId: string) => channexFetch(env, `/channels/${channelId}/deactivate`, { method: 'POST' });
export const channexDeleteChannel = (env: Env, channelId: string) => channexFetch(env, `/channels/${channelId}`, { method: 'DELETE' });
export const channexGetChannel = (env: Env, channelId: string) => channexFetch<{ data?: { attributes?: { is_active?: boolean; title?: string } } }>(env, `/channels/${channelId}`);

/** Pulls the bookings that already exist on the OTA into Channex (runs in the background, no guest notifications). */
export const channexLoadFutureReservations = (env: Env, channelId: string, listingId?: string) =>
  channexFetch(env, `/channels/${channelId}/execute/load_future_reservations`, { method: 'POST', body: JSON.stringify(listingId ? { listing_id: listingId } : {}) });

/** Airbnb sign-in link (valid two hours). After approval Airbnb returns the browser to `redirectUri`
 *  with ?success=true&channel_id=…&token=…; `token` is ours, echoed back. */
export function channexAirbnbConnectionLink(env: Env, p: { groupId: string; propertyId: string; redirectUri: string; failureRedirectUri: string; token: string; channelId?: string }) {
  return channexFetch<{ data?: { attributes?: { url: string } } }>(env, '/meta/airbnb/connection_link', {
    method: 'POST',
    body: JSON.stringify({ connection_link: {
      group_id: p.groupId, properties: [p.propertyId], redirect_uri: p.redirectUri, failure_redirect_uri: p.failureRedirectUri, token: p.token,
      ...(p.channelId ? { channel_id: p.channelId } : {}),
    } }),
  });
}

export const channexAirbnbListings = (env: Env, channelId: string) =>
  channexFetch<{ data?: { listing_id_dictionary?: { values?: { id: string; title: string; type: string; city: string; occupancies: number[] }[] } } }>(env, `/channels/${channelId}/action/listings`);

/** Maps one Airbnb listing to the unit's rate plan. Airbnb confirms it asynchronously (about 30 seconds). */
export const channexCreateMapping = (env: Env, channelId: string, ratePlanId: string, settings: Record<string, unknown>) =>
  channexFetch<{ data?: { id: string } }>(env, `/channels/${channelId}/mappings`, { method: 'POST', body: JSON.stringify({ mapping: { rate_plan_id: ratePlanId, settings } }) });

export const channexDeleteMapping = (env: Env, channelId: string, mappingId: string) =>
  channexFetch(env, `/channels/${channelId}/mappings/${mappingId}`, { method: 'DELETE' });
