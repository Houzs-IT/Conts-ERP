/* A Works or Built-in line ships from On-site, and on-site stock is put there by the receipt its delivery raises from the
   line's own PO or production order (on-site flow). A line with neither has nothing to receive, so its delivery took
   stock that never came: On-site went 0 -> -1 (click sweep 2, G4). Such a line is reported short, like a bound line with
   no PO elsewhere, so the operator is asked before it ships. */

/** PURE. The on-site unit-bound lines with no live PO or production order line and not enough on hand where they ship. */
export function onSiteLinesWithNothingComing<T extends { soItemId: string | null; itemCode: string; qty: number; warehouseId: string }>(
  lines: readonly T[],
  unitBound: ReadonlySet<string>,
  ordered: ReadonlySet<string>,
  onHand: ReadonlyMap<string, number>,
): T[] {
  return lines.filter((l) => unitBound.has(l.itemCode)
    && !(l.soItemId != null && ordered.has(l.soItemId))
    && (onHand.get(`${l.warehouseId}::${l.itemCode}`) ?? 0) < Number(l.qty));
}

/** The sales-order lines among `soItemIds` that a live PO or production order is raised for. A failed read answers
    every line as ordered: a missed warning is the old behaviour, a refused delivery on a database blip is not. */
export async function orderedSoItemIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the scm PostgREST client is untyped
  sb: any,
  soItemIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(soItemIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const [po, pro] = await Promise.all([
    sb.from('purchase_order_items').select('so_item_id, po:purchase_orders!inner(status)').in('so_item_id', ids),
    sb.from('production_order_items').select('so_item_id, order:production_orders!inner(status)').in('so_item_id', ids),
  ]);
  if (po.error || pro.error) return new Set(ids);
  const live = (rows: unknown[], key: 'po' | 'order') => (rows as Array<Record<string, unknown>>)
    .filter((r) => String((r[key] as { status?: string } | null)?.status ?? '') !== 'CANCELLED')
    .map((r) => String(r.so_item_id));
  return new Set([...live(po.data ?? [], 'po'), ...live(pro.data ?? [], 'order')]);
}
