import type { Env } from './db';

/** HostPlatform External API (the Postman collection "HostPlatform External API (Aug2026)", payload version 2).
 *  Every call goes through hpGet: the one place that knows the server, the access token, the timeout, the pause
 *  between calls and what to do when HostPlatform answers "too many requests". Read-only: nothing here writes to
 *  HostPlatform. There is no HostPlatform test server for us, so staging and production both read the live one. */

const TIMEOUT_MS = 20_000;
/** At least this long between two calls from one worker: about four calls a second. */
const MIN_GAP_MS = 250;
const MAX_TRIES = 3;
const PAGE_SIZE = 50;

export const hostplatformConfigured = (env: Env): boolean => !!env.HOSTPLATFORM_BASE_URL && !!env.HOSTPLATFORM_ACCESS_TOKEN;

export interface HpResult<T> { ok: boolean; status: number; body: T | null }

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
// ponytail: the pause is per worker instance, so two pulls on two instances are not paced against each other. The pull
// endpoint lets one pull start a minute, so that does not happen in practice; move this to a Durable Object if it does.
let lastCallAt = 0;

async function hpGet(env: Env, path: string): Promise<HpResult<unknown>> {
  const { HOSTPLATFORM_BASE_URL: base, HOSTPLATFORM_ACCESS_TOKEN: token } = env;
  if (!base || !token) return { ok: false, status: 0, body: null };
  for (let attempt = 1; ; attempt++) {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    const res = await fetch(base.replace(/\/+$/, '') + path, {
      headers: { 'access-token': token, 'x-api-version': '2', accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Too many requests or a server hiccup: wait as told (Retry-After, capped at 30 s) or 2 s, 4 s, then give up.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_TRIES) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(after > 0 ? Math.min(after, 30) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON: the caller reports the status */ }
    return { ok: res.ok, status: res.status, body };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** One reservation as V2 sends it. Only the fields every row has are required; real rows were seen without
 *  guest_details (blocks), source_id (HostPlatform's own bookings) and updated_at. */
export interface HpReservation {
  code: string; check_in_date: string; check_out_date: string; status: string; source: string;
  unit: string; unit_id: string; property: string; property_id: string;
  source_id?: string | null; remarks?: string | null; created_at?: string | null; updated_at?: string | null;
  guest_details?: Record<string, unknown> | null; price_details?: Record<string, unknown> | null; service_fees?: Record<string, unknown> | null;
}

export const isHpReservation = (v: unknown): v is HpReservation =>
  isRecord(v) && ['code', 'check_in_date', 'check_out_date', 'status', 'source', 'unit', 'unit_id', 'property', 'property_id'].every(k => isText(v[k]))
  && ['guest_details', 'price_details', 'service_fees'].every(k => v[k] === undefined || v[k] === null || isRecord(v[k]));

export interface HpProperty { id: string; name: string }

/** Every property the token can see (GET /external/v1/listing/properties). */
export async function hostplatformProperties(env: Env): Promise<HpResult<HpProperty[]>> {
  const res = await hpGet(env, '/external/v1/listing/properties');
  if (!res.ok || !Array.isArray(res.body)) return { ok: false, status: res.status, body: null };
  const body = res.body.filter(isRecord).filter(p => isText(p.propertyId)).map(p => ({ id: String(p.propertyId), name: String(p.propertyName ?? '') }));
  return { ok: true, status: res.status, body };
}

export interface HpReservationPage { reservations: HpReservation[]; malformed: number; nextCursor: string | null }

/** One page (50) of a property's reservations, cancelled ones included: those whose stay overlaps from..to, or with
 *  updatedAfter (an ISO instant) only those changed since then, whatever their dates. Pass the returned nextCursor
 *  back for the next page; null means this was the last. */
export async function hostplatformReservationPage(env: Env, p: { propertyId: string; from: string; to: string; updatedAfter?: string | null; cursor?: string | null }): Promise<HpResult<HpReservationPage>> {
  const q = new URLSearchParams({ type: 'property', property_id: p.propertyId, status: 'all', limit: String(PAGE_SIZE),
    ...(p.updatedAfter ? { updated_after: p.updatedAfter } : { check_in_date: p.from, check_out_date: p.to }) });
  if (p.cursor) q.set('cursor', p.cursor);
  const res = await hpGet(env, `/external/v1/reservations?${q}`);
  if (!res.ok || !isRecord(res.body) || !Array.isArray(res.body.reservations)) return { ok: false, status: res.status, body: null };
  const { reservations: rows, paging } = res.body;
  const reservations = rows.filter(isHpReservation);
  const next = isRecord(paging) && paging.has_more === true && isText(paging.next_cursor) ? paging.next_cursor : null;
  return { ok: true, status: res.status, body: { reservations, malformed: rows.length - reservations.length, nextCursor: next } };
}
