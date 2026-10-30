/**
 * Attendance arithmetic (migration 0166, PLAN-hr-employees.md phase 2). No database code: the portal, the desk and the
 * tests share it.
 */

export interface Point { lat: number; lng: number }
/** A building with a map location and its punch radius (its own, migration 0183, or ON_SITE_METRES). */
export interface Site extends Point { id: string; name: string; radiusM: number }
export interface Nearest { id: string; name: string; metres: number; radiusM: number; onSite: boolean }

/** The radius a building gets until it is given its own (Employees > Hours > Punch Sites). Only a label: nothing is
 *  blocked by distance (Hookka's soft geofence). */
export const ON_SITE_METRES = 200;

/** An open punch older than this is a forgotten clock-out, not a long shift (Houzs Century's rule): a clock-out after
 *  midnight still closes the night's punch, one the next afternoon does not. */
export const FORGOTTEN_AFTER_HOURS = 16;

const toRad = (d: number): number => (d * Math.PI) / 180;

/** Metres between two points on the earth (haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Where a punch was: the closest site whose circle holds it (on site), else the closest site of all (off site, with its
 * distance). Null when the punch has no location or there is no site to compare with. A small site inside a wide one
 * wins when it is closer, so "At Block A" is not hidden by a wide circle round the building next door.
 */
export function placeOf(p: Point | null, sites: Site[]): Nearest | null {
  if (!p) return null;
  let inside: Nearest | null = null;
  let closest: Nearest | null = null;
  for (const s of sites) {
    const metres = distanceM(p, s);
    const n: Nearest = { id: s.id, name: s.name, metres, radiusM: s.radiusM, onSite: metres <= s.radiusM };
    if (n.onSite && (!inside || metres < inside.metres)) inside = n;
    if (!closest || metres < closest.metres) closest = n;
  }
  return inside ?? closest;
}

/** Whether a punch with no clock-out has been open too long to be a shift still going. */
export function openTooLong(clockInAt: string, now = Date.now()): boolean {
  return now - Date.parse(clockInAt) > FORGOTTEN_AFTER_HOURS * 3_600_000;
}

/** A day with no clock-out that nobody will close: marked so (by the next clock-in, a refused clock-out or the hourly
 *  job), or open past FORGOTTEN_AFTER_HOURS. Payroll pays it as a normal shift (Hookka rule, 16 Jun 2026). */
export function isForgottenOut(r: { clock_in_at: string; clock_out_at: string | null; forgot_out: number }, now = Date.now()): boolean {
  return !!r.forgot_out || (!r.clock_out_at && openTooLong(r.clock_in_at, now));
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
