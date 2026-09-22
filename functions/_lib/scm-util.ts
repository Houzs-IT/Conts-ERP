/** Shared helpers for the ported SCM modules. Money is integer sen; flags are 0/1. */

export const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

export const intOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** A 0/1 flag from a JS boolean/number/string, or null when the key was absent. */
export const flag = (v: unknown): 0 | 1 | null => {
  if (v === undefined) return null;
  return v === true || v === 1 || v === '1' ? 1 : 0;
};

/** `<prefix>-<12 hex>` id, matching the products/suppliers convention. */
export const genId = (prefix: string): string => `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
