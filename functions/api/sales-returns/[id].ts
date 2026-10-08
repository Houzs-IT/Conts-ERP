import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { toSretHeaderPayload, toSretLinePayload, type SretHeaderRow, type SretLineRow } from '../../_lib/sales-returns';
import { postStockMovement } from '../../_lib/stock-ops';

const HEADER_SQL = `
  SELECT sr.id, sr.return_number, sr.sales_order_id, sr.delivery_order_id, sr.customer_name, sr.return_date, sr.reason, sr.status,
         sr.credit_note_ref, sr.refund_sen, sr.notes, sr.created_at, sr.updated_at,
         so.doc_no AS so_doc_no, d.do_number
  FROM sales_returns sr
  LEFT JOIN sales_orders so ON so.id = sr.sales_order_id
  LEFT JOIN delivery_orders d ON d.id = sr.delivery_order_id WHERE sr.id = ?`;

/** GET /api/sales-returns/:id — header + lines. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<SretHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That sales return does not exist.', 404);
  const lines = await all<SretLineRow>(env, 'SELECT id, delivery_order_line_id, line_no, item_code, description, uom, qty_returned, unit_price_sen, line_total_sen, reason FROM sales_return_lines WHERE sales_return_id = ? ORDER BY line_no', id);
  return json({ data: { ...toSretHeaderPayload(header), lines: lines.map(toSretLinePayload) } });
};

/** PATCH /api/sales-returns/:id — COMPLETED (mark done) or CANCELLED (reverses stock + delivered_qty). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change sales returns.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; return_number: string; warehouse_id: string | null }>(env,
    'SELECT sr.status, sr.return_number, d.warehouse_id FROM sales_returns sr LEFT JOIN delivery_orders d ON d.id = sr.delivery_order_id WHERE sr.id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That sales return does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.status === 'COMPLETED') {
    if (cur.status !== 'POSTED') return fail('CONFLICT', 'Only a posted return can be completed.', 409);
    await run(env, 'UPDATE sales_returns SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?', 'COMPLETED', now, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_return.complete', entityTable: 'sales_returns', entityId: id });
    return json({ id });
  }

  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id });
    const lines = await all<{ delivery_order_line_id: string | null; item_code: string; qty_returned: number }>(env, 'SELECT delivery_order_line_id, item_code, qty_returned FROM sales_return_lines WHERE sales_return_id = ?', id);
    for (const l of lines) {
      // Put the delivered qty back (the return is undone) and clear the DO line's returned mark.
      if (l.delivery_order_line_id) {
        await run(env, 'UPDATE delivery_order_lines SET returned_qty = GREATEST(0, returned_qty - ?) WHERE id = ?', l.qty_returned, l.delivery_order_line_id);
        const dl = await one<{ sales_order_line_id: string | null }>(env, 'SELECT sales_order_line_id FROM delivery_order_lines WHERE id = ?', l.delivery_order_line_id);
        if (dl?.sales_order_line_id) await run(env, 'UPDATE sales_order_lines SET delivered_qty = delivered_qty + ? WHERE id = ?', l.qty_returned, dl.sales_order_line_id);
      }
      // Take the returned goods back out of the warehouse (reverses the RETURN movement).
      if (cur.warehouse_id && l.qty_returned > 0) await postStockMovement(env, { itemCode: l.item_code, warehouseId: cur.warehouse_id, qtyDelta: -l.qty_returned, movementType: 'RETURN', refType: 'SRET-REV', refId: id, note: `${cur.return_number} cancelled`, movedAt: now.slice(0, 10), createdBy: session.userId });
    }
    await run(env, 'UPDATE sales_returns SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_return.cancel', entityTable: 'sales_returns', entityId: id });
    return json({ id });
  }

  return fail('VALIDATION', 'Only COMPLETED or CANCELLED are accepted.', 422);
};
