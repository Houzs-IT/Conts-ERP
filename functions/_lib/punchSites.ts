import { z } from 'zod';

/**
 * Punch sites (migration 0174): where a phone punch counts as on site, besides the buildings. The fields and their rules,
 * shared by the API and the Punch Sites tab; the geometry is in attendanceCalc.ts.
 */

export interface PunchSite { id: string; name: string; lat: number; lng: number; radiusM: number; active: boolean }
export interface PunchSiteRow { id: string; name: string; lat: number; lng: number; radius_m: number; is_active: number }
export const SITE_COLS = 'id, name, lat, lng, radius_m, is_active';
export const toSite = (r: PunchSiteRow): PunchSite => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, radiusM: r.radius_m, active: !!r.is_active });

export const RADIUS_MIN = 20;
export const RADIUS_MAX = 5000;
export const NOT_MIGRATED_SITES = 'Punch sites need a database update (migration 0174) that has not been applied yet.';

export const siteInput = z.object({
  name: z.string().trim().min(1, 'Give the site a name.').max(80, 'Keep the name under 80 characters.'),
  lat: z.number({ error: 'Enter the latitude.' }).min(-90, 'Latitude is between -90 and 90.').max(90, 'Latitude is between -90 and 90.'),
  lng: z.number({ error: 'Enter the longitude.' }).min(-180, 'Longitude is between -180 and 180.').max(180, 'Longitude is between -180 and 180.'),
  radiusM: z.number({ error: 'Enter the radius in metres.' }).int('Radius is a whole number of metres.')
    .min(RADIUS_MIN, `Radius is at least ${RADIUS_MIN} m.`).max(RADIUS_MAX, `Radius is at most ${RADIUS_MAX} m.`),
  active: z.boolean().default(true),
});
export type SiteInput = z.infer<typeof siteInput>;

/** A Google Maps link to a point, for the desk. */
export const mapLink = (lat: number, lng: number): string => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** "3.139003, 101.686855" pasted from a map pin, or null when it is not a pair of coordinates. */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
