/**
 * Attendance arithmetic (migration 0166, PLAN-hr-employees.md phase 2). No database code: the portal, the desk and the
 * tests share it.
 */

export interface Point { lat: number; lng: number }
export interface Building extends Point { id: string; name: string }
export interface Nearest { id: string; name: string; metres: number }

/** Within this distance of a building a punch reads "At <building>"; further out it reads "<distance> from <building>".
 *  Only a label: nothing is blocked by distance (Hookka's soft geofence). ponytail: one radius for every building, a
 *  per-building radius if large sites need it. */
export const ON_SITE_METRES = 200;

const toRad = (d: number): number => (d * Math.PI) / 180;

/** Metres between two points on the earth (haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** The closest building to a punch, or null when the punch has no location or no building has one. */
export function nearestBuilding(p: Point | null, buildings: Building[]): Nearest | null {
  if (!p) return null;
  let best: Nearest | null = null;
  for (const b of buildings) {
    const metres = distanceM(p, b);
    if (!best || metres < best.metres) best = { id: b.id, name: b.name, metres };
  }
  return best;
}

/** A coordinate a phone sent, or null for a missing or impossible one (a denied reading must not be stored). */
export function coord(v: unknown, limit: 90 | 180): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** Minutes worked between two ISO instants; an open punch counts up to `now`. Never negative. */
export function workedMinutes(inAt: string, outAt: string | null, now = Date.now()): number {
  const end = outAt ? Date.parse(outAt) : now;
  return Math.max(0, Math.floor((end - Date.parse(inAt)) / 60_000));
}

/** "HH:MM" on a Malaysia day to an ISO instant (Malaysia is UTC+8 all year). Null for a malformed time. */
export function mytInstant(day: string, hhmm: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  return new Date(`${day}T${hhmm}:00+08:00`).toISOString();
}
