/* The product categories and the ONE name a person sees for each.

   MFG_PRODUCT_CATEGORIES is the `mfg_product_category` PG enum in declaration
   order; the routes validate against it and the HR item-KPI picker reads it, so
   a screen can never offer a category the column cannot hold. Keep it in step
   with the enum if it ever gains a member.

   The list staff keep is scm.product_category_groups: a group created under
   Accounting > Item Groups extends the enum and that table at run time, with no
   code change. So nothing here is a complete list. A route asks the database for
   a value not in this list (routes/renovation-catalog-settings.ts
   loadCategoryGroups); a screen reads useRenovationCatalog, which hands the rows
   to rememberCategories so a plain label lookup knows them too.

   The labels live beside the list so every screen (SKU Master tabs, the Modular
   chips / select / grid, the category picker) says the same word. FABRIC_ACCESSORY
   reads "Sofa Accessory" (owner 2026-09-14); the code keeps no 'sofa' in it on
   purpose, because readers test a line group with includes('sofa').

   Mirrored byte-for-byte at frontend/src/vendor/shared/product-categories.ts. */
export const MFG_PRODUCT_CATEGORIES = [
  'SOFA', 'BEDFRAME', 'ACCESSORY', 'FABRIC_ACCESSORY', 'MATTRESS', 'BEDLINES', 'DINING', 'DIFFUSER', 'CARPET', 'SERVICE',
  // Renovation groups (Conts, migration 0060; renovation-catalog.ts holds the tree).
  'WORKS', 'BUILTIN', 'FURNITURE', 'LIGHTING', 'APPLIANCE', 'SOFT',
  'AIRBNB', // migration 0162
  'RAW', // migration 0189
] as const;

export type MfgProductCategory = (typeof MFG_PRODUCT_CATEGORIES)[number];

export const MFG_CATEGORY_LABELS: Readonly<Record<MfgProductCategory, string>> = {
  SOFA: 'Sofa',
  BEDFRAME: 'Bedframe',
  ACCESSORY: 'Accessory',
  FABRIC_ACCESSORY: 'Sofa Accessory',
  MATTRESS: 'Mattress',
  BEDLINES: 'Bedlines',
  DINING: 'Dining',
  DIFFUSER: 'Diffuser',
  CARPET: 'Carpet',
  SERVICE: 'Service',
  WORKS: 'Works',
  BUILTIN: 'Built-in',
  FURNITURE: 'Furniture',
  LIGHTING: 'Lighting',
  APPLIANCE: 'Appliances',
  SOFT: 'Soft furnishing',
  AIRBNB: 'Airbnb supplies',
  RAW: 'Raw material',
};

export function isMfgProductCategory(c: string | null | undefined): c is MfgProductCategory {
  return (MFG_PRODUCT_CATEGORIES as readonly string[]).includes(String(c ?? ''));
}

/* The master list as last read by this browser tab. Only the frontend fills it:
   a Worker isolate outlives a request, so routes pass the list they read instead. */
const liveCategories = new Map<string, string>();

export function rememberCategories(rows: ReadonlyArray<{ code: string; label: string }>): void {
  liveCategories.clear();
  for (const r of rows) liveCategories.set(r.code.toUpperCase(), r.label);
}

export function liveCategoryRows(): Array<{ code: string; label: string }> {
  return [...liveCategories].map(([code, label]) => ({ code, label }));
}

export function isLiveCategory(c: string | null | undefined): boolean {
  return liveCategories.has(String(c ?? '').toUpperCase());
}

/** The enum list plus every category added at run time. */
export function allMfgCategories(): string[] {
  return [...MFG_PRODUCT_CATEGORIES, ...[...liveCategories.keys()].filter((c) => !isMfgProductCategory(c))];
}

/** A category's label: the built-in name, the master list's name, else its code in words ("CURTAIN_WORK" -> "Curtain work"). */
export function mfgCategoryLabel(c: string | null | undefined): string {
  const up = String(c ?? '').toUpperCase();
  if (isMfgProductCategory(up)) return MFG_CATEGORY_LABELS[up];
  const live = liveCategories.get(up);
  if (live) return live;
  const words = up.replace(/_+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/* Read a category the way a person types it into a sheet: the stored code in
   any case ("fabric_accessory", "Sofa accessory" -> FABRIC_ACCESSORY) or its
   label. null for a blank cell or a value that is not a category, so an import
   can tell "left blank" from "typed something unrecognisable" instead of
   silently ignoring both. `live` is the master list, for a category added at run time. */
export function parseMfgCategory(input: string | null | undefined, live: ReadonlyArray<{ code: string; label: string }> = []): MfgProductCategory | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const code = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (isMfgProductCategory(code)) return code;
  const asLabel = raw.toUpperCase().replace(/[\s_]+/g, ' ');
  const found = MFG_PRODUCT_CATEGORIES.find((c) => MFG_CATEGORY_LABELS[c].toUpperCase() === asLabel);
  if (found) return found;
  return (live.find((g) => g.code.toUpperCase() === code || g.label.toUpperCase().replace(/[\s_]+/g, ' ') === asLabel)?.code.toUpperCase() as MfgProductCategory | undefined) ?? null;
}
