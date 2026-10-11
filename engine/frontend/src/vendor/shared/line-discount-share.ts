/* The part of a line's discount that travels with PART of the line.
 *
 * A sales order line's `discount_sen` is a whole-line amount (line total =
 * qty x unit - discount). When that line is delivered, or a delivery invoiced,
 * a few units at a time, each piece carries its share of the discount, so the
 * pieces' discounts add up to the line's discount exactly — never the whole
 * discount on every piece (Conts owner decision C5, 11 Oct 2026: line
 * discounts carry through from sales orders to delivery orders and invoices).
 *
 * The share is the difference of two rounded cumulative amounts, so integer
 * sen telescope: however the line is split, the pieces sum to the discount
 * once the whole quantity has moved, and the last piece absorbs the rounding.
 * Quantity past the line's own (an over-delivery) carries no discount.
 *
 * PURE. Mirrored byte-for-byte at frontend/src/vendor/shared. */
export function lineDiscountShare(
  lineDiscountSen: number,
  lineQty: number,
  alreadyMovedQty: number,
  movingQty: number,
): number {
  const discount = Math.max(0, Math.trunc(Number(lineDiscountSen) || 0));
  const qty = Number(lineQty) || 0;
  if (discount === 0 || qty <= 0) return 0;
  const before = Math.min(qty, Math.max(0, Number(alreadyMovedQty) || 0));
  const after = Math.min(qty, before + Math.max(0, Number(movingQty) || 0));
  const upTo = (q: number) => (q >= qty ? discount : Math.round((discount * q) / qty));
  return upTo(after) - upTo(before);
}
