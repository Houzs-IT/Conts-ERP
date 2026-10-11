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

/** The part of a sales-order line's whole-line discount that travels with PART of the line (owner, 11 Oct 2026:
 *  line discounts carry through to delivery orders and invoices). Cumulative and rounded, so however the line is
 *  split the pieces add up to the discount exactly; quantity past the line's own carries none. Same rule as the
 *  engine's shared/line-discount-share.ts. */
export function lineDiscountShare(lineDiscountSen: number, lineQty: number, alreadyMovedQty: number, movingQty: number): number {
  const discount = Math.max(0, Math.trunc(Number(lineDiscountSen) || 0));
  const qty = Number(lineQty) || 0;
  if (discount === 0 || qty <= 0) return 0;
  const before = Math.min(qty, Math.max(0, Number(alreadyMovedQty) || 0));
  const after = Math.min(qty, before + Math.max(0, Number(movingQty) || 0));
  const upTo = (q: number) => (q >= qty ? discount : Math.round((discount * q) / qty));
  return upTo(after) - upTo(before);
}

/** A delivery-order or invoice line keeps no discount column (no migration): its discount is what its line total
 *  sits below quantity x unit price. */
export const lineDiscountOf = (qty: number, unitPriceSen: number, lineTotalSen: number): number =>
  Math.max(0, qty * unitPriceSen - lineTotalSen);
