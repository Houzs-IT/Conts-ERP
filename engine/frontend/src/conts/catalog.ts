// The Conts renovation catalog (spec 2026-10-09 section 3). The Products page shows the
// renovation SKU Master (group / sub-category chips, units, photos, main supplier) and hides
// the Houzs furniture-factory screens Conts does not use. Hidden, not deleted: the code and
// the direct routes stay, so turning this off brings the Houzs screens back unchanged.

/** The switch. Off restores the Houzs Products page exactly. */
export const CONTS_RENOVATION_CATALOG = true as boolean;

/** Products page tabs hidden in this instance (owner decision: Modular, Fabric Converter and
 *  the old Categories tab). Combo Pricing, Variants and Maintenance stay (owner default Q11). */
export const CONTS_HIDDEN_PRODUCT_TABS: ReadonlySet<string> = new Set(
  CONTS_RENOVATION_CATALOG ? ["modular", "fabric", "categories"] : [],
);

/** Maintenance lists hidden in this instance: fabric price tiers belong to the hidden
 *  Fabric Converter. */
export const CONTS_HIDDEN_MAINTENANCE_KEYS: ReadonlySet<string> = new Set(
  CONTS_RENOVATION_CATALOG ? ["fabrics"] : [],
);

export function visibleProductTabs<T extends { value: string }>(tabs: readonly T[]): T[] {
  return tabs.filter((t) => !CONTS_HIDDEN_PRODUCT_TABS.has(t.value));
}

/** The tab a `?tab=` value opens: a hidden or unknown one lands on the SKU Master. */
export function resolveProductTab<T extends string>(fromUrl: string | null, all: readonly T[]): T | "sku" {
  const t = fromUrl ?? "sku";
  return (all as readonly string[]).includes(t) && !CONTS_HIDDEN_PRODUCT_TABS.has(t) ? (t as T) : "sku";
}
