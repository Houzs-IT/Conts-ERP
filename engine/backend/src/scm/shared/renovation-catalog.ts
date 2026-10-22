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
}

export const RENOVATION_GROUPS: readonly GroupDef[] = [
  { code: 'WORKS', label: 'Works', stage: 'hardware' },
  { code: 'BUILTIN', label: 'Built-in', stage: 'furniture' },
  { code: 'FURNITURE', label: 'Furniture', stage: 'furniture' },
  { code: 'LIGHTING', label: 'Lighting', stage: 'hardware' },
  { code: 'APPLIANCE', label: 'Appliances', stage: 'appliances' },
  { code: 'SOFT', label: 'Soft furnishing', stage: 'soft_furnishing' },
  { code: 'SERVICE', label: 'Service', stage: 'soft_furnishing' },
];

export interface SubCategoryDef {
  group: CatalogGroup;
  code: string;
  label: string;
  sort: number;
  legacy?: readonly string[];
  /** false = hidden from pickers (Products > SKU Master > Sub-categories); existing SKUs keep it. */
  active?: boolean;
}

/* WORKS sort order is the site trade order (see renovation-stages.ts TRADE_ORDER).
   PARTITION, DOOR and FEATURE_WALL came with the Notion task categories (migration 0085).
   AIRCON_INSTALL, CLEANING and PROJECT_MGMT were WORKS until the owner filed them
   under Service (22 Oct 2026, migration 0141); they still act as site trades
   (SITE_TRADE_SERVICES below). */
export const SUB_CATEGORIES: readonly SubCategoryDef[] = [
  { group: 'WORKS', code: 'PROTECTION', label: 'Protection', sort: 10 },
  { group: 'WORKS', code: 'HACKING', label: 'Hacking', sort: 20 },
  { group: 'WORKS', code: 'PLUMBING', label: 'Plumbing', sort: 30 },
  { group: 'WORKS', code: 'WATERPROOFING', label: 'Waterproofing', sort: 40 },
  { group: 'WORKS', code: 'ELECTRICAL', label: 'Electrical', sort: 50 },
  { group: 'WORKS', code: 'MASONRY_TILING', label: 'Masonry / tiling', sort: 60 },
  { group: 'WORKS', code: 'PLASTER_CEILING', label: 'Plaster ceiling', sort: 70 },
  { group: 'WORKS', code: 'PARTITION', label: 'Partition', sort: 75 },
  { group: 'WORKS', code: 'ALUMINIUM_GLASS', label: 'Window / sliding door / glass', sort: 80 },
  { group: 'WORKS', code: 'DOOR', label: 'Door', sort: 82 },
  { group: 'WORKS', code: 'GRILL', label: 'Grill', sort: 85 },
  { group: 'WORKS', code: 'PAINTING', label: 'Painting', sort: 90 },
  { group: 'WORKS', code: 'TEXTURED_PAINTING', label: 'Textured painting', sort: 95 },
  { group: 'WORKS', code: 'FEATURE_WALL', label: 'Feature wall', sort: 97 },
  { group: 'WORKS', code: 'FLOORING', label: 'Flooring', sort: 100 },

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
  { group: 'LIGHTING', code: 'EYEBALL', label: 'Eye ball', sort: 15 },
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
  { group: 'SERVICE', code: 'AIRCON_INSTALL', label: 'Aircon install', sort: 50 },
  { group: 'SERVICE', code: 'CLEANING', label: 'Cleaning', sort: 60 },
  { group: 'SERVICE', code: 'PROJECT_MGMT', label: 'Project management', sort: 70 },
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

/* SUB_CATEGORIES above is the built-in seed. Sub-categories are edited at run time in
   scm.product_sub_categories, so a caller holding the database list passes it as
   `list`; without one the seed is used. WORKS stays fixed: its sub-categories are
   the site trades (renovation-stages.ts TRADE_ORDER, generic RN-* SKUs). */
export const FIXED_SUB_GROUPS: readonly CatalogGroup[] = ['WORKS'];

/* SERVICE sub-categories that are still site trades (owner, 22 Oct 2026: filed
   under Service, worked like Works). Everything that decides site work - trade
   tasks, the hardware stage and its auto-skip, a line's home stage, the reno-item
   condition, owner-supplied lines still getting a PO, the site-receipt photo rule -
   treats them as WORKS through siteGroupOf. Like WORKS they are fixed in settings. */
export const SITE_TRADE_SERVICES: readonly string[] = ['AIRCON_INSTALL', 'CLEANING', 'PROJECT_MGMT'];

/** The group a line WORKS AS on site: WORKS for a site-trade service, else its own group. */
export function siteGroupOf(group: CatalogGroup | null, sub: string | null | undefined): CatalogGroup | null {
  if (group === 'SERVICE' && SITE_TRADE_SERVICES.includes(String(sub ?? '').toUpperCase())) return 'WORKS';
  return group;
}

/** Whether a sub-category cannot be renamed, reordered or hidden in settings. */
export function isFixedSub(group: CatalogGroup, code: string): boolean {
  return FIXED_SUB_GROUPS.includes(group) || (group === 'SERVICE' && SITE_TRADE_SERVICES.includes(code.toUpperCase()));
}

export function subCategoriesOf(group: CatalogGroup, list: readonly SubCategoryDef[] = SUB_CATEGORIES): SubCategoryDef[] {
  return list.filter((s) => s.group === group).sort((a, b) => a.sort - b.sort);
}

/** The sub-category a legacy category implies; null when it implies none. */
export function legacySubOf(category: string | null | undefined): string | null {
  const c = String(category ?? '').toUpperCase();
  return SUB_CATEGORIES.find((s) => s.legacy?.includes(c))?.code ?? null;
}

export type CategoryPairResult =
  | { ok: true }
  | { ok: false; error: 'invalid_category' | 'sub_category_required' | 'sub_category_mismatch' };

export function validateCategoryPair(
  category: string | null | undefined,
  sub: string | null | undefined,
  list: readonly SubCategoryDef[] = SUB_CATEGORIES,
): CategoryPairResult {
  const c = String(category ?? '').toUpperCase();
  const group = categoryGroupOf(c);
  if (!group) return { ok: false, error: 'invalid_category' };
  const s = sub ? String(sub).toUpperCase() : null;
  if (!s) return NEW_GROUPS.has(c) ? { ok: false, error: 'sub_category_required' } : { ok: true };
  const def = list.find((d) => d.code === s);
  if (!def || def.group !== group) return { ok: false, error: 'sub_category_mismatch' };
  return { ok: true };
}

/** Default project stage of a line, from its product's stored category. */
export function defaultStageOf(category: string | null | undefined): StageKey | null {
  const g = categoryGroupOf(category);
  return g ? groupDef(g).stage : null;
}

/* The eight built-in units. The live list is scm.product_uoms (migration 0118,
   edited under Products > SKU Master > Units); these are its seed and the
   fallback while it loads. Helpers take the live list when the caller has it. */
export interface UomDef {
  code: string;
  label: string;
  printLabel: string;
  measure: boolean;
  builtin?: boolean;
  sort?: number;
  active?: boolean;
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

export function isUom(x: string | null | undefined, uoms: readonly UomDef[] = UOMS): boolean {
  return uoms.some((u) => u.code === String(x ?? '').toUpperCase());
}

export function uomPrintLabel(code: string | null | undefined, uoms: readonly UomDef[] = UOMS): string {
  const c = String(code ?? '').toUpperCase();
  return uoms.find((u) => u.code === c)?.printLabel ?? c;
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

/* Read a sub-category / unit the way a person types it into an import sheet:
   the code in any case ("plaster_ceiling", "Plaster ceiling") or its label; a
   unit also by its print label ("LS"). null for blank or unreadable, so an
   import can report what it could not read instead of dropping it. */
const normWord = (s: string) => s.trim().toUpperCase().replace(/[\s\-/]+/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ');

export function parseSubCategory(input: string | null | undefined, list: readonly SubCategoryDef[] = SUB_CATEGORIES): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const w = normWord(raw);
  return list.find((s) => normWord(s.code) === w || normWord(s.label) === w)?.code ?? null;
}

/** The code a new sub-category gets from its label: "Curtain install" -> CURTAIN_INSTALL. '' when nothing usable. */
export function subCategoryCodeOf(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

export function parseUom(input: string | null | undefined, uoms: readonly UomDef[] = UOMS): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const w = normWord(raw);
  return uoms.find((u) => normWord(u.code) === w || normWord(u.label) === w || normWord(u.printLabel) === w)?.code ?? null;
}
