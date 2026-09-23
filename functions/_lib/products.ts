/** Product master ("Products & Maintenance"), ported from Houzs ERP's mfg_products.
 *  Money is integer sen. Cost is finance-gated — never sent to a non-finance role. */

export const PRODUCT_CATEGORIES = [
  'SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'BEDLINES', 'DINING', 'DIFFUSER', 'CARPET', 'SERVICE',
] as const;
export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export function isCategory(v: unknown): v is ProductCategory {
  return typeof v === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(v);
}

export interface ProductRow {
  id: string; code: string; name: string; category: string; description: string | null;
  base_model: string | null; size_code: string | null; size_label: string | null;
  branding: string | null; barcode: string | null; unit_m3_milli: number; status: string;
  cost_price_sen: number; base_price_sen: number | null; price1_sen: number | null; sell_price_sen: number | null;
}

/** The first problem with a create body, or null. Field name matches the form. */
export function invalidProduct(b: { code?: unknown; name?: unknown; category?: unknown }): { field: string; message: string } | null {
  if (typeof b.code !== 'string' || !b.code.trim()) return { field: 'code', message: 'Enter a product code.' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { field: 'name', message: 'Enter a name.' };
  if (!isCategory(b.category)) return { field: 'category', message: 'Pick a category.' };
  return null;
}

/** DB row → API payload. Cost is present only when the caller may see finance. */
export function toProductPayload(r: ProductRow, canSeeCost: boolean) {
  return {
    id: r.id, code: r.code, name: r.name, category: r.category, description: r.description ?? '',
    baseModel: r.base_model ?? '', sizeCode: r.size_code ?? '', sizeLabel: r.size_label ?? '',
    branding: r.branding ?? '', barcode: r.barcode ?? '',
    unitM3Milli: r.unit_m3_milli, status: r.status,
    basePriceSen: r.base_price_sen, price1Sen: r.price1_sen, sellPriceSen: r.sell_price_sen,
    ...(canSeeCost ? { costPriceSen: r.cost_price_sen } : {}),
  };
}

/** A trimmed string, or null when empty. */
export const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

/** A whole number (rounded), or null when not a finite number. */
export const intOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
