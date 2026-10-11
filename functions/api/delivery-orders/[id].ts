import { type Env, all, one, run, json, fail, nowIso, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { nextDoStatus, maybeMarkSoDelivered, toDoHeaderPayload, toDoLinePayload, type DoHeaderRow, type DoLineRow } from '../../_lib/delivery-orders';
import { postStockMovement } from '../../_lib/stock-ops';

const HEADER_SQL = `
  SELECT d.id, d.do_number, d.sales_order_id, d.customer_name, d.do_date, d.expected_delivery_at, d.status,
         d.driver_name, d.vehicle, d.address1, d.city, d.state, d.postcode, d.phone, d.notes, d.warehouse_id, d.created_at, d.updated_at,
         so.doc_no AS so_doc_no, w.name AS warehouse_name
  FROM delivery_orders d
  LEFT JOIN sales_orders so ON so.id = d.sales_order_id
  LEFT JOIN warehouses w ON w.id = d.warehouse_id WHERE d.id = ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<DoHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That delivery order does not exist.', 404);
  const lines = await all<DoLineRow>(env, 'SELECT id, sales_order_line_id, line_no, item_code, description, uom, qty, returned_qty, unit_price_sen, line_total_sen FROM delivery_order_lines WHERE delivery_order_id = ? ORDER BY line_no', id);
  return json({ data: { ...toDoHeaderPayload(header), lines: lines.map(toDoLinePayload) } });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change delivery orders.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; sales_order_id: string | null; warehouse_id: string | null; do_number: string }>(env, 'SELECT status, sales_order_id, warehouse_id, do_number FROM delivery_orders WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That delivery order does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.action === 'advance') {
    const next = nextDoStatus(cur.status);
    if (!next) return fail('CONFLICT', 'This delivery order cannot advance further.', 409);
    const stamp = next === 'DISPATCHED' ? ', dispatched_at = ?' : next === 'DELIVERED' ? ', delivered_at = ?' : '';
    const args = stamp ? [next, now, now, id] : [next, now, id];
    await run(env, `UPDATE delivery_orders SET status = ?${stamp}, updated_at = ? WHERE id = ?`, ...args);
    if (next === 'DELIVERED' && cur.sales_order_id) await maybeMarkSoDelivered(env, cur.sales_order_id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_order.advance', entityTable: 'delivery_orders', entityId: id, after: { status: next } });
    return json({ id, status: next });
  }

  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id });
    if (cur.status === 'DELIVERED' || cur.status === 'INVOICED') return fail('CONFLICT', 'A delivered delivery order cannot be cancelled.', 409);
    // Reverse the delivered_qty this DO added to the SO.
    const lines = await all<{ sales_order_line_id: string | null; item_code: string; qty: number }>(env, 'SELECT sales_order_line_id, item_code, qty FROM delivery_order_lines WHERE delivery_order_id = ?', id);
    for (const l of lines) {
      if (l.sales_order_line_id) await run(env, 'UPDATE sales_order_lines SET delivered_qty = GREATEST(0, delivered_qty - ?) WHERE id = ?', l.qty, l.sales_order_line_id);
      // Return the stock this DO issued out of the dispatch warehouse.
      if (cur.warehouse_id && l.qty > 0) await postStockMovement(env, { itemCode: l.item_code, warehouseId: cur.warehouse_id, qtyDelta: l.qty, movementType: 'ISSUE', refType: 'DO-REV', refId: id, note: `${cur.do_number} cancelled`, movedAt: mytToday(), createdBy: session.userId });
    }
    await run(env, 'UPDATE delivery_orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_order.cancel', entityTable: 'delivery_orders', entityId: id });
    return json({ id });
  }

  return fail('VALIDATION', 'Use action=advance, or status=CANCELLED.', 422);
};
