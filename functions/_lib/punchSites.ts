import { z } from 'zod';

/**
 * Punch sites (migration 0174): the buildings a phone punch is checked against, each with its own radius. The fields
 * and their rules, shared by the API and the Punch Sites tab; the geometry is in attendanceCalc.ts.
 */

/** A building as the Punch Sites tab shows it. `radiusM` is the building's own radius, null for the default. */
export interface PunchSite { id: string; name: string; lat: number | null; lng: number | null; radiusM: number | null }
export interface PunchSiteRow { id: string; name: string; latitude: number | null; longitude: number | null; punch_radius_m: number | null }
export const SITE_COLS = 'id, name, latitude, longitude, punch_radius_m';
export const toSite = (r: PunchSiteRow): PunchSite => ({ id: r.id, name: r.name, lat: r.latitude, lng: r.longitude, radiusM: r.punch_radius_m });

export const RADIUS_MIN = 20;
export const RADIUS_MAX = 5000;
export const NOT_MIGRATED_SITES = 'Punch radiuses need a database update (migration 0174) that has not been applied yet.';

/** A building's radius, or null to go back to the default. */
export const radiusInput = z.object({
  radiusM: z.number({ error: 'Enter the radius in metres.' }).int('Radius is a whole number of metres.')
    .min(RADIUS_MIN, `Radius is at least ${RADIUS_MIN} m.`).max(RADIUS_MAX, `Radius is at most ${RADIUS_MAX} m.`).nullable(),
});

/** A Google Maps link to a point, for the desk. */
export const mapLink = (lat: number, lng: number): string => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
