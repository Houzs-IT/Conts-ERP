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

export const channexProperty = (env: Env, propertyId: string) => channexFetch<{ data: any }>(env, `/properties/${propertyId}`);
export const channexRoomTypes = (env: Env, propertyId: string) => channexFetch<{ data: any[] }>(env, `/room_types?filter[property_id]=${propertyId}`);
export const channexRatePlans = (env: Env, propertyId: string) => channexFetch<{ data: any[] }>(env, `/rate_plans?filter[property_id]=${propertyId}`);
export const channexBookings = (env: Env, propertyId: string) => channexFetch<{ data: any[] }>(env, `/bookings?filter[property_id]=${propertyId}`);

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
