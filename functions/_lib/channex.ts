import type { Env } from './db';

/** staging.channex.io while we test. Swap for the production base (app.channex.io) and a production
 *  key only once we move past the demo property to a real listing — see TODO.md. */
const BASE = 'https://staging.channex.io/api/v1';

async function channexFetch<T = unknown>(env: Env, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T | null }> {
  if (!env.CHANNEX_API_KEY) return { ok: false, status: 0, body: null };
  const res = await fetch(BASE + path, {
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
