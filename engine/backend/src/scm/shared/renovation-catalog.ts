/* The renovation catalog: category groups, sub-categories and units of measure.

   ONE definition shared by the catalog (phase 1), the sales documents (phase 2)
   and the project stages (phase 3). Mirrored byte-for-byte at
   frontend/src/vendor/shared/renovation-catalog.ts; migration 0061 seeds the
   same rows into scm.product_category_groups / scm.product_sub_categories and a
   parity test compares them.

   The group is stored in mfg_products.category (new enum values) for new SKUs.
   Legacy Houzs categories are never renamed; LEGACY_GROUP maps them so every
   reader can ask one question: which group, which sub-category. */

export type StageKey =
  | 'design'
  | 'key_permit'
  | 'defect_check'
  | 'shop_drawings'
  | 'hardware'
  | 'furniture'
  | 'appliances'
  | 'soft_furnishing'
  | 'handover'
  | 'warranty'
  | 'closed';

export const CATALOG_GROUPS = ['WORKS', 'BUILTIN', 'FURNITURE', 'LIGHTING', 'APPLIANCE', 'SOFT', 'SERVICE'] as const;
export type CatalogGroup = (typeof CATALOG_GROUPS)[number];

export interface GroupDef {
  code: CatalogGroup;
  label: string;
  stage: StageKey;
  photoRequired: boolean;
}

export const RENOVATION_GROUPS: readonly GroupDef[] = [
  { code: 'WORKS', label: 'Works', stage: 'hardware', photoRequired: false },
  { code: 'BUILTIN', label: 'Built-in', stage: 'furniture', photoRequired: true },
  { code: 'FURNITURE', label: 'Furniture', stage: 'furniture', photoRequired: true },
  { code: 'LIGHTING', label: 'Lighting', stage: 'hardware', photoRequired: true },
  { code: 'APPLIANCE', label: 'Appliances', stage: 'appliances', photoRequired: true },
  { code: 'SOFT', label: 'Soft furnishing', stage: 'soft_furnishing', photoRequired: true },
  { code: 'SERVICE', label: 'Service', stage: 'soft_furnishing', photoRequired: false },
];

export interface SubCategoryDef {
  group: CatalogGroup;
  code: string;
  label: string;
  sort: number;
  legacy?: readonly string[];
}

/* WORKS sort order is the site trade order (see renovation-stages.ts TRADE_ORDER). */
export const SUB_CATEGORIES: readonly SubCategoryDef[] = [
  { group: 'WORKS', code: 'PROTECTION', label: 'Protection', sort: 10 },
  { group: 'WORKS', code: 'HACKING', label: 'Hacking', sort: 20 },
  { group: 'WORKS', code: 'PLUMBING', label: 'Plumbing', sort: 30 },
  { group: 'WORKS', code: 'WATERPROOFING', label: 'Waterproofing', sort: 40 },
  { group: 'WORKS', code: 'ELECTRICAL', label: 'Electrical', sort: 50 },
  { group: 'WORKS', code: 'MASONRY_TILING', label: 'Masonry / tiling', sort: 60 },
  { group: 'WORKS', code: 'PLASTER_CEILING', label: 'Plaster ceiling', sort: 70 },
  { group: 'WORKS', code: 'ALUMINIUM_GLASS', label: 'Window / sliding door / glass', sort: 80 },
  { group: 'WORKS', code: 'GRILL', label: 'Grill', sort: 85 },
  { group: 'WORKS', code: 'PAINTING', label: 'Painting', sort: 90 },
  { group: 'WORKS', code: 'TEXTURED_PAINTING', label: 'Textured painting', sort: 95 },
  { group: 'WORKS', code: 'FLOORING', label: 'Flooring', sort: 100 },
  { group: 'WORKS', code: 'AIRCON_INSTALL', label: 'Aircon install', sort: 110 },
  { group: 'WORKS', code: 'CLEANING', label: 'Cleaning', sort: 120 },
  { group: 'WORKS', code: 'PROJECT_MGMT', label: 'Project management', sort: 130 },

  { group: 'BUILTIN', code: 'KITCHEN_CABINET', label: 'Kitchen cabinet', sort: 10 },
  { group: 'BUILTIN', code: 'WARDROBE', label: 'Wardrobe', sort: 20 },
  { group: 'BUILTIN', code: 'TV_CABINET', label: 'TV cabinet', sort: 30 },
  { group: 'BUILTIN', code: 'SHOE_CABINET', label: 'Shoe cabinet', sort: 40 },
  { group: 'BUILTIN', code: 'STUDY_TABLE', label: 'Study table', sort: 50 },
  { group: 'BUILTIN', code: 'COUNTERTOP', label: 'Countertop (stone)', sort: 60 },
  { group: 'BUILTIN', code: 'SHELVING', label: 'Shelving', sort: 70 },

  { group: 'FURNITURE', code: 'SOFA', label: 'Sofa', sort: 10, legacy: ['SOFA'] },
  { group: 'FURNITURE', code: 'BEDFRAME', label: 'Bedframe', sort: 20, legacy: ['BEDFRAME'] },
  { group: 'FURNITURE', code: 'MATTRESS', label: 'Mattress', sort: 30, legacy: ['MATTRESS'] },
  { group: 'FURNITURE', code: 'DINING', label: 'Dining', sort: 40, legacy: ['DINING'] },
  { group: 'FURNITURE', code: 'TABLES', label: 'Tables', sort: 50 },
  { group: 'FURNITURE', code: 'LOOSE_STORAGE', label: 'Loose storage', sort: 60 },
  { group: 'FURNITURE', code: 'ACCESSORY', label: 'Accessory', sort: 70, legacy: ['ACCESSORY', 'FABRIC_ACCESSORY', 'OTHERS'] },

  { group: 'LIGHTING', code: 'DOWNLIGHT', label: 'Downlight', sort: 10 },
  { group: 'LIGHTING', code: 'PENDANT', label: 'Pendant', sort: 20 },
  { group: 'LIGHTING', code: 'LED_STRIP', label: 'LED strip', sort: 30 },
  { group: 'LIGHTING', code: 'CEILING_FAN', label: 'Ceiling fan', sort: 40 },

  { group: 'APPLIANCE', code: 'TV', label: 'TV', sort: 10 },
  { group: 'APPLIANCE', code: 'FRIDGE', label: 'Fridge', sort: 20 },
  { group: 'APPLIANCE', code: 'WASHER', label: 'Washer', sort: 30 },
  { group: 'APPLIANCE', code: 'WATER_HEATER', label: 'Water heater', sort: 40 },
  { group: 'APPLIANCE', code: 'HOOD_HOB', label: 'Hood / hob', sort: 50 },
  { group: 'APPLIANCE', code: 'AIRCON_UNIT', label: 'Aircon unit', sort: 60 },

  { group: 'SOFT', code: 'CURTAIN_BLINDS', label: 'Curtain / blinds', sort: 10 },
  { group: 'SOFT', code: 'BED_LINEN', label: 'Bed linen', sort: 20, legacy: ['BEDLINES'] },
  { group: 'SOFT', code: 'AMENITIES', label: 'Amenities', sort: 30 },
  { group: 'SOFT', code: 'DECORATION', label: 'Decoration', sort: 40 },
  { group: 'SOFT', code: 'CARPET', label: 'Carpet', sort: 50, legacy: ['CARPET'] },
  { group: 'SOFT', code: 'DIFFUSER', label: 'Diffuser', sort: 60, legacy: ['DIFFUSER'] },

  { group: 'SERVICE', code: 'DELIVERY', label: 'Delivery', sort: 10 },
  { group: 'SERVICE', code: 'STYLING', label: 'Styling', sort: 20 },
  { group: 'SERVICE', code: 'PHOTOSHOOT', label: 'Photoshoot', sort: 30 },
  { group: 'SERVICE', code: 'AIRBNB_SETUP', label: 'Airbnb setup', sort: 40 },
];

/* Legacy Houzs category -> group. SERVICE maps to itself with no sub-category. */
const LEGACY_GROUP: Readonly<Record<string, CatalogGroup>> = {
  SOFA: 'FURNITURE',
  BEDFRAME: 'FURNITURE',
  MATTRESS: 'FURNITURE',
  DINING: 'FURNITURE',
  ACCESSORY: 'FURNITURE',
  FABRIC_ACCESSORY: 'FURNITURE',
  OTHERS: 'FURNITURE',
  BEDLINES: 'SOFT',
  CARPET: 'SOFT',
  DIFFUSER: 'SOFT',
  SERVICE: 'SERVICE',
};

const NEW_GROUPS: ReadonlySet<string> = new Set(['WORKS', 'BUILTIN', 'FURNITURE', 'LIGHTING', 'APPLIANCE', 'SOFT']);

export function isCatalogGroup(x: string | null | undefined): x is CatalogGroup {
  return (CATALOG_GROUPS as readonly string[]).includes(String(x ?? ''));
}

export function groupDef(group: CatalogGroup): GroupDef {
  const g = RENOVATION_GROUPS.find((d) => d.code === group);
  if (!g) throw new Error(`unknown catalog group ${group}`);
  return g;
}

/** The group a stored category belongs to; null for a value that is not a category. */
export function categoryGroupOf(category: string | null | undefined): CatalogGroup | null {
  const c = String(category ?? '').toUpperCase();
  if (NEW_GROUPS.has(c)) return c as CatalogGroup;
  return LEGACY_GROUP[c] ?? null;
}

export function subCategoriesOf(group: CatalogGroup): SubCategoryDef[] {
  return SUB_CATEGORIES.filter((s) => s.group === group).sort((a, b) => a.sort - b.sort);
}

/** The sub-category a legacy category implies; null when it implies none. */
export function legacySubOf(category: string | null | undefined): string | null {
  const c = String(category ?? '').toUpperCase();
  return SUB_CATEGORIES.find((s) => s.legacy?.includes(c))?.code ?? null;
}

/** Photo rule keys on the STORED category, so legacy Houzs categories stay exempt. */
export function isPhotoRequiredCategory(category: string | null | undefined): boolean {
  const c = String(category ?? '').toUpperCase();
  if (!NEW_GROUPS.has(c)) return false;
  return groupDef(c as CatalogGroup).photoRequired;
}

export type CategoryPairResult =
  | { ok: true }
  | { ok: false; error: 'invalid_category' | 'sub_category_required' | 'sub_category_mismatch' };

export function validateCategoryPair(category: string | null | undefined, sub: string | null | undefined): CategoryPairResult {
  const c = String(category ?? '').toUpperCase();
  const group = categoryGroupOf(c);
  if (!group) return { ok: false, error: 'invalid_category' };
  const s = sub ? String(sub).toUpperCase() : null;
  if (!s) return NEW_GROUPS.has(c) ? { ok: false, error: 'sub_category_required' } : { ok: true };
  const def = SUB_CATEGORIES.find((d) => d.code === s);
  if (!def || def.group !== group) return { ok: false, error: 'sub_category_mismatch' };
  return { ok: true };
}

/** Default project stage of a line, from its product's stored category. */
export function defaultStageOf(category: string | null | undefined): StageKey | null {
  const g = categoryGroupOf(category);
  return g ? groupDef(g).stage : null;
}

export interface UomDef {
  code: string;
  label: string;
  printLabel: string;
  measure: boolean;
}

export const UOMS: readonly UomDef[] = [
  { code: 'PCS', label: 'Pieces', printLabel: 'PCS', measure: false },
  { code: 'UNIT', label: 'Unit', printLabel: 'UNIT', measure: false },
  { code: 'SET', label: 'Set', printLabel: 'SET', measure: false },
  { code: 'LOT', label: 'Lump sum', printLabel: 'LS', measure: false },
  { code: 'FT', label: 'Feet (run)', printLabel: 'FT', measure: true },
  { code: 'SQFT', label: 'Square feet', printLabel: 'SQFT', measure: true },
  { code: 'POINT', label: 'Point', printLabel: 'POINT', measure: false },
  { code: 'FULL', label: 'Full unit', printLabel: 'FULL UNIT', measure: false },
];

export function isUom(x: string | null | undefined): boolean {
  return UOMS.some((u) => u.code === String(x ?? '').toUpperCase());
}

export function uomPrintLabel(code: string | null | undefined): string {
  const c = String(code ?? '').toUpperCase();
  return UOMS.find((u) => u.code === c)?.printLabel ?? c;
}

/* Generic SKUs: one per WORKS and SERVICE sub-category (code RN-<SUB>), so every
   priced line of a quotation or SO can pick a SKU and carry a free-text
   description. Seeded by migration 0064; the trade of a line is still the SKU's
   sub_category. Measured trades default to their measuring unit. */
export const GENERIC_SKU_GROUPS: readonly CatalogGroup[] = ['WORKS', 'SERVICE'];

const GENERIC_UOM: Readonly<Record<string, string>> = {
  ELECTRICAL: 'POINT',
  PLASTER_CEILING: 'SQFT',
  MASONRY_TILING: 'SQFT',
  FLOORING: 'SQFT',
  WATERPROOFING: 'SQFT',
};

export interface GenericSkuDef {
  code: string;
  group: CatalogGroup;
  sub: string;
  name: string;
  uom: string;
}

export function genericSkuCode(sub: string): string {
  return `RN-${String(sub).toUpperCase()}`;
}

export function genericSkus(): GenericSkuDef[] {
  return GENERIC_SKU_GROUPS.flatMap((g) =>
    subCategoriesOf(g).map((s) => ({
      code: genericSkuCode(s.code),
      group: g,
      sub: s.code,
      name: `${groupDef(g).label} - ${s.label}`,
      uom: GENERIC_UOM[s.code] ?? 'LOT',
    })),
  );
}
