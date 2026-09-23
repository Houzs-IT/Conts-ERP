import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/mrp — material requirements: per item, open sales demand minus on-hand stock
 *  minus on-order (open POs) = net to buy. Read-only planning view. A first-cut MRP:
 *  quantity-only, no lead-time / lot-size / BOM explosion (those are follow-ups). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const demand = await all<{ item_code: string; d: number }>(env, `
    SELECT sl.item_code, SUM(sl.qty - sl.delivered_qty) AS d
    FROM sales_order_lines sl JOIN sales_orders so ON so.id = sl.sales_order_id
    WHERE so.status IN ('CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','SHIPPED')
    GROUP BY sl.item_code HAVING SUM(sl.qty - sl.delivered_qty) > 0`);
  const onOrder = await all<{ item_code: string; o: number }>(env, `
    SELECT pl.item_code, SUM(pl.qty - pl.received_qty) AS o
    FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id
    WHERE po.status IN ('SUBMITTED','PARTIALLY_RECEIVED')
    GROUP BY pl.item_code`);
  const onHand = await all<{ item_code: string; h: number }>(env, 'SELECT item_code, SUM(qty_delta) AS h FROM stock_movements GROUP BY item_code');

  const map = new Map<string, { itemCode: string; demand: number; onHand: number; onOrder: number }>();
  const get = (code: string) => { let r = map.get(code); if (!r) { r = { itemCode: code, demand: 0, onHand: 0, onOrder: 0 }; map.set(code, r); } return r; };
  for (const d of demand) get(d.item_code).demand = d.d;
  for (const o of onOrder) if (map.has(o.item_code)) get(o.item_code).onOrder = o.o; // only items with demand matter for planning
  for (const h of onHand) if (map.has(h.item_code)) get(h.item_code).onHand = h.h;

  const codes = [...map.keys()];
  const names = codes.length
    ? await all<{ code: string; name: string }>(env, `SELECT code, name FROM products WHERE code IN (${codes.map(() => '?').join(',')})`, ...codes)
    : [];
  const nameOf = new Map(names.map(n => [n.code, n.name]));

  const data = [...map.values()].map(r => ({
    itemCode: r.itemCode, itemName: nameOf.get(r.itemCode) ?? '', demand: r.demand, onHand: Math.max(0, r.onHand), onOrder: r.onOrder,
    net: Math.max(0, r.demand - Math.max(0, r.onHand) - r.onOrder),
  })).sort((a, b) => b.net - a.net || a.itemCode.localeCompare(b.itemCode));

  return json({ generatedAt: nowIso(), data });
};
