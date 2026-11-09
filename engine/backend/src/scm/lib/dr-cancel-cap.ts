/* Cancelling a Delivery Return puts its units back on the SO lines' delivered
 * total. A return frees those units for a later DO to ship again, so cancelling
 * it after a re-ship would leave the line above its ordered qty (qty 10, DO1
 * ships 10, DR returns 4, DO2 ships 4, cancel DR -> 14 delivered).
 *
 * Houzs closes this with a DB trigger (127f66943, migration
 * 20261029T1000) that calls its SO -> DO over-delivery cap function; Conts never
 * received that cap, so the check lives here and uses the same remaining
 * (qty - delivered + returned, soDeliverableRemaining) the DO screens cap against.
 */
import { soDeliverableRemaining } from '../routes/delivery-orders-mfg';

export type DrCancelOverDelivery = { soItemId: string; remaining: number; returnedByThisDr: number };

/** Lines whose remaining would go below zero once this return's units come back off. */
export function drCancelOverDeliveries(
  returnedBySoItem: Map<string, number>,
  remainingBySoItem: Map<string, number>,
): DrCancelOverDelivery[] {
  const out: DrCancelOverDelivery[] = [];
  for (const [soItemId, returnedByThisDr] of returnedBySoItem) {
    if (returnedByThisDr <= 0) continue;
    const remaining = remainingBySoItem.get(soItemId);
    if (remaining === undefined) continue; // line cancelled or gone: nothing left to over-deliver
    if (remaining - returnedByThisDr < 0) out.push({ soItemId, remaining, returnedByThisDr });
  }
  return out;
}

export const DR_CANCEL_OVER_DELIVERS = {
  error: 'cancel_over_delivers',
  message:
    'Cancelling this return would put a Sales Order line above its ordered qty, because a later Delivery Order ' +
    'already re-shipped the returned units. Cancel or reduce that Delivery Order first.',
} as const;

/** null when the cancel is safe; the refusal body when it is not; 'unreadable' when a read failed. */
export async function drCancelCapRefusal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST-shaped client, as in the routes.
  sb: any,
  drId: string,
): Promise<null | 'unreadable' | (typeof DR_CANCEL_OVER_DELIVERS & { lines: DrCancelOverDelivery[] })> {
  const { data: drLines, error: drErr } = await sb.from('delivery_return_items')
    .select('do_item_id, qty_returned').eq('delivery_return_id', drId);
  if (drErr) return 'unreadable';
  const byDoItem = new Map<string, number>();
  for (const l of (drLines ?? []) as Array<{ do_item_id: string | null; qty_returned: number | null }>) {
    const q = Number(l.qty_returned ?? 0);
    if (!l.do_item_id || q <= 0) continue;
    byDoItem.set(l.do_item_id, (byDoItem.get(l.do_item_id) ?? 0) + q);
  }
  if (byDoItem.size === 0) return null;
  const { data: doLines, error: doErr } = await sb.from('delivery_order_items')
    .select('id, so_item_id').in('id', [...byDoItem.keys()]);
  if (doErr) return 'unreadable';
  const returnedBySoItem = new Map<string, number>();
  for (const d of (doLines ?? []) as Array<{ id: string; so_item_id: string | null }>) {
    if (!d.so_item_id) continue;
    returnedBySoItem.set(d.so_item_id, (returnedBySoItem.get(d.so_item_id) ?? 0) + (byDoItem.get(d.id) ?? 0));
  }
  if (returnedBySoItem.size === 0) return null;
  const { data: soLines, error: soErr } = await sb.from('mfg_sales_order_items')
    .select('doc_no').in('id', [...returnedBySoItem.keys()]);
  if (soErr) return 'unreadable';
  const docNos = [...new Set(((soLines ?? []) as Array<{ doc_no: string | null }>).map((r) => r.doc_no).filter((d): d is string => !!d))];
  const deliverable = await soDeliverableRemaining(sb, docNos);
  const remaining = new Map<string, number>();
  for (const id of returnedBySoItem.keys()) {
    const d = deliverable.get(id);
    if (d) remaining.set(id, d.remaining);
  }
  const lines = drCancelOverDeliveries(returnedBySoItem, remaining);
  return lines.length > 0 ? { ...DR_CANCEL_OVER_DELIVERS, lines } : null;
}
