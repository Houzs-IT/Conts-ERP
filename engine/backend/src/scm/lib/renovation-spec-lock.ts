/* Goods received fix a line's spec and price (owner, 4 Nov 2026: "收货过后就不能更改规格"; of the price, "肯定锁").
   The goods are in the warehouse as ordered, so a new SKU or new options would deliver something other than what stock
   holds, and move stock between variants; a new price would replace the line, flag its PO line and order it again.
   Partly received locks the whole line, as a partly delivered line freezes (shared/so-line-freeze.ts).
   Qty, remark and dates stay editable. */
import { canonicalizeVariants } from '../shared/so-variant-rule';
import { variantsForCompare } from './amendment-noop-lines';

export const SPEC_LOCKED_ERROR = 'line_received';

export function specLockedMessage(itemCode: string, poNumber: string): string {
  return `${itemCode} has goods received on ${poNumber}, so its SKU, options and price are locked.`;
}

/** Does this edit move the line's SKU, options or price? An absent value means unchanged. */
export function specMoved(
  cur: { itemCode: string | null; group: string | null; variants: unknown; unitPriceSen?: number | null },
  next: { itemCode?: string | null; variants?: unknown; unitPriceSen?: number | null },
): boolean {
  const code = next.itemCode?.trim();
  if (code && code !== (cur.itemCode ?? '').trim()) return true;
  if (next.unitPriceSen != null && Math.round(Number(next.unitPriceSen)) !== Math.round(Number(cur.unitPriceSen ?? 0))) return true;
  if (next.variants === undefined || next.variants === null) return false;
  const read = (v: unknown) => variantsForCompare(canonicalizeVariants(cur.group ?? '', (v ?? {}) as Record<string, unknown>));
  return read(cur.variants) !== read(next.variants);
}

export interface AmendedLine { salesOrderItemId?: string | null; changeType?: string; newItemCode?: string | null; newVariants?: unknown; newUnitPriceSen?: number | null }

/** The first line of an SO amendment that would change the spec or price of received goods, or null. Only a SPEC line can. */
export async function receivedSpecRefusal(sb: any, docNo: string, lines: AmendedLine[]): Promise<{ itemCode: string; poNumber: string } | null> {
  const spec = lines.filter((l) => String(l.changeType ?? 'SPEC').toUpperCase() === 'SPEC' && l.salesOrderItemId);
  if (spec.length === 0) return null;
  const ids = spec.map((l) => l.salesOrderItemId as string);
  const { data: received, error: recErr } = await sb.from('purchase_order_items')
    .select('so_item_id, purchase_order_id').in('so_item_id', ids).gt('received_qty', 0);
  if (recErr) throw new Error(recErr.message);
  if (!received?.length) return null;
  const { data: pos, error: poErr } = await sb.from('purchase_orders')
    .select('id, po_number').in('id', [...new Set(received.map((r: { purchase_order_id: string }) => r.purchase_order_id))]).neq('status', 'CANCELLED');
  if (poErr) throw new Error(poErr.message);
  const poNumber = new Map<string, string>((pos ?? []).map((p: { id: string; po_number: string }) => [p.id, p.po_number]));
  const lockedBy = new Map<string, string>();
  for (const r of received as Array<{ so_item_id: string; purchase_order_id: string }>) {
    const po = poNumber.get(r.purchase_order_id);
    if (po) lockedBy.set(r.so_item_id, po);
  }
  if (lockedBy.size === 0) return null;
  const { data: items, error: itemErr } = await sb.from('mfg_sales_order_items')
    .select('id, item_code, item_group, variants, unit_price_sen').eq('doc_no', docNo).in('id', [...lockedBy.keys()]);
  if (itemErr) throw new Error(itemErr.message);
  for (const it of (items ?? []) as Array<{ id: string; item_code: string; item_group: string | null; variants: unknown; unit_price_sen: number | null }>) {
    const l = spec.find((x) => x.salesOrderItemId === it.id)!;
    if (specMoved({ itemCode: it.item_code, group: it.item_group, variants: it.variants, unitPriceSen: it.unit_price_sen }, { itemCode: l.newItemCode, variants: l.newVariants, unitPriceSen: l.newUnitPriceSen })) {
      return { itemCode: it.item_code, poNumber: lockedBy.get(it.id)! };
    }
  }
  return null;
}

/** What is received on each SO line across its live POs, so the SO page can show the lock before the server refuses.
    A failed read reports nothing received: the refusals above stay the gate. */
export async function soLineReceivedQty(sb: any, soItemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (soItemIds.length === 0) return out;
  try {
    const { data: rows, error } = await sb.from('purchase_order_items')
      .select('so_item_id, purchase_order_id, received_qty').in('so_item_id', soItemIds).gt('received_qty', 0);
    if (error || !rows?.length) return out;
    const { data: pos, error: poErr } = await sb.from('purchase_orders')
      .select('id').in('id', [...new Set((rows as Array<{ purchase_order_id: string }>).map((r) => r.purchase_order_id))]).neq('status', 'CANCELLED');
    if (poErr) return out;
    const live = new Set((pos ?? []).map((p: { id: string }) => p.id));
    for (const r of rows as Array<{ so_item_id: string; purchase_order_id: string; received_qty: number }>) {
      if (live.has(r.purchase_order_id)) out.set(r.so_item_id, (out.get(r.so_item_id) ?? 0) + Number(r.received_qty));
    }
  } catch { /* silent-write-ok: a display hint on a read */ }
  return out;
}
