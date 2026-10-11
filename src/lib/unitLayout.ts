/** A unit's layout, as cleaning and the owner name it. Stored in units.layout_type (0102); shared by the app and
 *  functions/ so the Units form, the units API and the Cleaning board say the same thing. */

export const LAYOUTS = [
  ['studio', 'Studio'],
  ['1_bedroom', '1 bedroom'],
  ['2_bedroom', '2 bedroom'],
  ['3_bedroom', '3 bedroom'],
  ['4_plus_bedroom', '4+ bedroom'],
  ['duplex', 'Duplex'],
  ['dual_key', 'Dual key'],
  ['penthouse', 'Penthouse'],
  ['other', 'Other'],
] as const;
export type LayoutType = typeof LAYOUTS[number][0];
export const isLayoutType = (v: unknown): v is LayoutType => typeof v === 'string' && LAYOUTS.some(l => l[0] === v);

/** The type a bedroom count implies, for a unit whose type was never picked. */
export function layoutFromBedrooms(bedrooms: number | null | undefined): LayoutType | null {
  if (bedrooms == null || !Number.isFinite(bedrooms)) return null;
  if (bedrooms <= 0) return 'studio';
  if (bedrooms >= 4) return '4_plus_bedroom';
  return `${bedrooms}_bedroom` as LayoutType;
}

export const layoutName = (t: string | null | undefined) => LAYOUTS.find(l => l[0] === t)?.[1] ?? null;

/** "2 bedroom · 2 bath", "Studio · 1 bath", "Duplex · 3 bedroom · 2 bath": what the Cleaning board shows. */
export function layoutLabel(type: string | null | undefined, bedrooms: number | null | undefined, bathrooms: number | null | undefined): string {
  const t = isLayoutType(type) ? type : layoutFromBedrooms(bedrooms);
  const parts: string[] = [];
  if (t) parts.push(layoutName(t)!);
  // A type that is not a bedroom count (duplex, dual key, penthouse, other) still says how many bedrooms.
  if (t && !/bedroom|studio/.test(t) && bedrooms != null) parts.push(`${bedrooms} bedroom`);
  if (bathrooms != null) parts.push(`${bathrooms} bath`);
  return parts.join(' · ');
}
