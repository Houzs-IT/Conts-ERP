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
export function channexPushRate(env: Env, p: { propertyId: string; ratePlanId: string; dateFrom: string; dateTo: string; rate: number }) {
  return channexFetch<{ data: { id: string }[] }>(env, '/restrictions', {
    method: 'POST',
    body: JSON.stringify({ values: [{ property_id: p.propertyId, rate_plan_id: p.ratePlanId, date_from: p.dateFrom, date_to: p.dateTo, rate: p.rate }] }),
  });
}

export function channexPushAvailability(env: Env, p: { propertyId: string; roomTypeId: string; dateFrom: string; dateTo: string; availability: number }) {
  return channexFetch<{ data: { id: string }[] }>(env, '/availability', {
    method: 'POST',
    body: JSON.stringify({ values: [{ property_id: p.propertyId, room_type_id: p.roomTypeId, date_from: p.dateFrom, date_to: p.dateTo, availability: p.availability }] }),
  });
}

/** { [roomTypeId]: { [date]: count } } for the room types on this property in the window. */
export function channexAvailability(env: Env, p: { propertyId: string; roomTypeId: string; dateFrom: string; dateTo: string }) {
  return channexFetch<{ data: Record<string, Record<string, number>> }>(
    env, `/availability?filter[property_id]=${p.propertyId}&filter[room_type_id]=${p.roomTypeId}&filter[date][gte]=${p.dateFrom}&filter[date][lte]=${p.dateTo}`,
  );
}

/* ---- Setting up a unit as a Channex listing (stage 5) ---- */

/** One Channex property per unit, typed as an apartment: a vacation rental is billed per unit, while
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

export function channexCreateRatePlan(env: Env, p: { propertyId: string; roomTypeId: string; maxGuests: number; rate: number }) {
  return channexFetch<{ data: { id: string } }>(env, '/rate_plans', {
    method: 'POST',
    body: JSON.stringify({ rate_plan: {
      title: 'Standard rate', property_id: p.propertyId, room_type_id: p.roomTypeId, currency: 'MYR',
      sell_mode: 'per_room', rate_mode: 'manual', options: [{ occupancy: p.maxGuests, is_primary: true, rate: p.rate }],
    } }),
  });
}

export const channexDeleteProperty = (env: Env, propertyId: string) => channexFetch(env, `/properties/${propertyId}`, { method: 'DELETE' });

/** A short-lived pass that lets a Conts user open Channex's own screens for one property without a Channex login. */
export function channexOneTimeToken(env: Env, p: { propertyId: string; username: string }) {
  return channexFetch<{ data: { token: string } }>(env, '/auth/one_time_token', {
    method: 'POST',
    body: JSON.stringify({ one_time_token: { property_id: p.propertyId, username: p.username } }),
  });
}

/** Channex's channel-connection screen for one property, embedded ("headless"). `channels` limits it to the OTAs we sell on. */
export function channexChannelScreenUrl(env: Env, p: { token: string; propertyId: string }) {
  const q = new URLSearchParams({ oauth_session_key: p.token, app_mode: 'headless', redirect_to: '/channels', property_id: p.propertyId, available_channels: 'ABB,BDC,AGO', lng: 'en' });
  return `${channexServer(env)}/auth/exchange?${q.toString()}`;
}
