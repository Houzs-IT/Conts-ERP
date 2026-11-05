/* When a production order's raw material is ordered and arrives (owner, 5 Nov 2026): 7 days and 1 day before the order's
   date. A date already past becomes today, so a late order can read "order today, arrive today". The trigger in
   migration 0223 applies the same rule to materials that come from a SKU's composition. */

const shift = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

export function materialDates(orderDate: string | null, today: string): { processingDate: string | null; deliveryDate: string | null } {
  if (!orderDate) return { processingDate: null, deliveryDate: null };
  const notPast = (d: string): string => (d < today ? today : d);
  return { processingDate: notPast(shift(orderDate, 7)), deliveryDate: notPast(shift(orderDate, 1)) };
}

/** Today in Malaysia, as the trigger reads it. */
export const klToday = (now: Date = new Date()): string => new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
