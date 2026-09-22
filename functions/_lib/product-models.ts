/** Product models, ported from 2990's SCM. A model groups SKUs of one design.
 *  Category shares the 9-value app set with products (2990's MFG_PRODUCT_CATEGORIES). */
import { PRODUCT_CATEGORIES, isCategory } from './products';

export { PRODUCT_CATEGORIES, isCategory };

export interface ModelRow {
  id: string; model_code: string; name: string; category: string;
  branding: string | null; description: string | null; photo_url: string | null;
  allowed_options: unknown; active: number;
}

export function toModelPayload(r: ModelRow) {
  return {
    id: r.id, modelCode: r.model_code, name: r.name, category: r.category,
    branding: r.branding ?? '', description: r.description ?? '', photoUrl: r.photo_url ?? '',
    allowedOptions: r.allowed_options ?? {}, active: r.active === 1,
  };
}

export function invalidModel(b: { modelCode?: unknown; name?: unknown; category?: unknown }): { field: string; message: string } | null {
  if (typeof b.modelCode !== 'string' || !b.modelCode.trim()) return { field: 'modelCode', message: 'Enter a model code.' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { field: 'name', message: 'Enter a name.' };
  if (!isCategory(b.category)) return { field: 'category', message: 'Pick a category.' };
  return null;
}

export const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

/** A 0/1 flag from a JS boolean/number, or null when absent. */
export const flag = (v: unknown): 0 | 1 | null => {
  if (v === undefined) return null;
  return v === true || v === 1 || v === '1' ? 1 : 0;
};
