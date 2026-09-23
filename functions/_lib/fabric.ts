/** Fabric library, ported from 2990's SCM. Furniture upholstery catalogue. Surcharge sen. */

export interface FabricRow {
  id: string; fabric_code: string | null; label: string; tier: string; default_surcharge_sen: number;
  sofa_tier: string | null; bedframe_tier: string | null; swatch_key: string | null; active: number; sort_order: number;
}

export function toFabricPayload(r: FabricRow) {
  return {
    id: r.id, fabricCode: r.fabric_code ?? '', label: r.label, tier: r.tier, defaultSurchargeSen: r.default_surcharge_sen,
    sofaTier: r.sofa_tier ?? '', bedframeTier: r.bedframe_tier ?? '', swatchKey: r.swatch_key ?? '', active: r.active === 1, sortOrder: r.sort_order,
  };
}

export function invalidFabric(b: { id?: unknown; label?: unknown }): { field: string; message: string } | null {
  if (typeof b.id !== 'string' || !b.id.trim()) return { field: 'id', message: 'Enter a fabric id.' };
  if (typeof b.label !== 'string' || !b.label.trim()) return { field: 'label', message: 'Enter a label.' };
  return null;
}
