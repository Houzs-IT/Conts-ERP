/** The order of the Units screen's tree, and the unit it opens when the address names none. Pure (no imports) so the
 *  server (functions/api/units/detail.ts, ?first=1) picks the same unit the screen will, by the same rule. */

export const NO_STATE = 'State not set';
export const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
export const stateOf = (b: { state?: string | null }) => b.state?.trim() || NO_STATE;
export const byState = (a: string, b: string) => (a === NO_STATE ? 1 : b === NO_STATE ? -1 : byName(a, b));
export const unitKey = (u: { unitCode: string; listingName: string }) => u.unitCode || u.listingName;

export interface OrderBuilding { id: string; name: string; state?: string | null }
export interface OrderUnit { id: string; buildingId: string; parentUnitId?: string | null; unitCode: string; listingName: string }

/** The unit at the top of the tree: states in name order ("State not set" last), buildings by name, then the
 *  building's first top-level unit by code. With no top-level unit anywhere, the first unit in the list. */
export function firstUnitId(buildings: OrderBuilding[], units: OrderUnit[]): string | undefined {
  const order = [...buildings].sort((a, b) => byState(stateOf(a), stateOf(b)) || byName(a.name, b.name));
  for (const b of order) {
    const top = units.filter(u => u.buildingId === b.id && !u.parentUnitId).sort((x, y) => byName(unitKey(x), unitKey(y)));
    if (top.length) return top[0].id;
  }
  return units[0]?.id;
}
