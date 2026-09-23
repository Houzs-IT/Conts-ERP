/** Delivery Zones, ported from 2990's SCM zone-classify. The postcode-prefix -> zone map.
 *  prefixStart..prefixEnd are the FIRST TWO digits of a Malaysian postcode (00..99). */

export const ZONES = [
  'KL', 'PJ', 'KLANG', 'KAJANG', 'RAWANG', 'PUCHONG', // Klang Valley
  'NS', 'MELAKA', 'JOHOR',                            // Southern corridor
  'PENANG', 'KEDAH', 'PERAK',                         // Northern
  'PAHANG', 'EAST',                                   // Outer
] as const;
export const ZONE_SET: ReadonlySet<string> = new Set(ZONES);

export interface ZonePrefixRule { zone: string; prefixStart: number; prefixEnd: number }

/** The in-code fallback used until the company customises the map (2990 parity). */
export const DEFAULT_ZONE_PREFIX_MAP: readonly ZonePrefixRule[] = [
  { zone: 'KEDAH', prefixStart: 5, prefixEnd: 9 },
  { zone: 'PENANG', prefixStart: 10, prefixEnd: 14 },
  { zone: 'PERAK', prefixStart: 30, prefixEnd: 36 },
  { zone: 'EAST', prefixStart: 15, prefixEnd: 24 },
  { zone: 'PAHANG', prefixStart: 25, prefixEnd: 28 },
  { zone: 'PAHANG', prefixStart: 39, prefixEnd: 39 },
  { zone: 'PAHANG', prefixStart: 49, prefixEnd: 49 },
  { zone: 'PAHANG', prefixStart: 69, prefixEnd: 69 },
  { zone: 'PJ', prefixStart: 40, prefixEnd: 40 },
  { zone: 'KLANG', prefixStart: 41, prefixEnd: 42 },
  { zone: 'KAJANG', prefixStart: 43, prefixEnd: 43 },
  { zone: 'PJ', prefixStart: 46, prefixEnd: 47 },
  { zone: 'RAWANG', prefixStart: 48, prefixEnd: 48 },
  { zone: 'KL', prefixStart: 50, prefixEnd: 60 },
  { zone: 'KL', prefixStart: 68, prefixEnd: 68 },
  { zone: 'NS', prefixStart: 70, prefixEnd: 73 },
  { zone: 'MELAKA', prefixStart: 75, prefixEnd: 78 },
  { zone: 'JOHOR', prefixStart: 79, prefixEnd: 86 },
];

export interface ZoneRow {
  id: string; zone: string; prefix_start: number; prefix_end: number; label: string | null; is_active: number;
}

export function toZonePayload(r: ZoneRow) {
  return { id: r.id, zone: r.zone, prefixStart: r.prefix_start, prefixEnd: r.prefix_end, label: r.label ?? '', isActive: r.is_active === 1 };
}

/** Validate a create/patch body. prefixes are 0..99, start <= end, zone required. */
export function invalidZone(b: { zone?: unknown; prefixStart?: unknown; prefixEnd?: unknown }): { field: string; message: string } | null {
  if (typeof b.zone !== 'string' || !b.zone.trim()) return { field: 'zone', message: 'Pick a zone.' };
  const s = Number(b.prefixStart), e = Number(b.prefixEnd);
  if (!Number.isInteger(s) || s < 0 || s > 99) return { field: 'prefixStart', message: 'Start prefix must be 0–99.' };
  if (!Number.isInteger(e) || e < 0 || e > 99) return { field: 'prefixEnd', message: 'End prefix must be 0–99.' };
  if (e < s) return { field: 'prefixEnd', message: 'End prefix is before the start.' };
  return null;
}
