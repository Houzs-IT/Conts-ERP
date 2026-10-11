import { type Env, all, one, run, json, fail, nowIso, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { normalizeLines, toPoHeaderPayload, toPoLinePayload, checkPricedBody, type PoHeaderRow, type PoLineRow } from '../../_lib/purchase-orders';
import { invalid, type Fields } from '../../_lib/validate';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const HEADER_SQL = `
  SELECT po.id, po.po_number, po.supplier_id, po.status, po.po_date, po.expected_at, po.warehouse_id, po.currency,
         po.subtotal_sen, po.tax_sen, po.total_sen, po.notes, po.submitted_at, po.received_at, po.cancelled_at,
         po.created_at, po.updated_at, s.code AS supplier_code, s.name AS supplier_name
  FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`;

/** GET /api/purchase-orders/:id — header + supplier + lines. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<PoHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That purchase order does not exist.', 404);
  const lines = await all<PoLineRow>(env, `SELECT id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, received_qty, notes
                                           FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_no`, id);
  return json({ data: { ...toPoHeaderPayload(header), lines: lines.map(toPoLinePayload) } });
};

/** PATCH /api/purchase-orders/:id — cancel (any non-received), or edit while SUBMITTED. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change purchase orders.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; subtotal_sen: number; tax_sen: number }>(env, 'SELECT status, subtotal_sen, tax_sen FROM purchase_orders WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That purchase order does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  // Cancel action.
  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id });
    if (cur.status === 'RECEIVED') return fail('CONFLICT', 'A fully received purchase order cannot be cancelled.', 409);
    await run(env, 'UPDATE purchase_orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_order.cancel', entityTable: 'purchase_orders', entityId: id });
    return json({ id });
  }
  if (b.status !== undefined) return fail('VALIDATION', 'Receiving statuses are set by goods receipt, not directly.', 422);

  // Edit (header + optional line replacement) — only while SUBMITTED.
  if (cur.status !== 'SUBMITTED') return fail('CONFLICT', 'Only a submitted purchase order can be edited.', 409);

  const fields: Fields = {};
  checkPricedBody(fields, b, 'poDate', 'PO date');
  const bad = invalid(fields); if (bad) return bad;

  const sets: string[] = [];
  const args: unknown[] = [];
  if (b.supplierId !== undefined) {
    const sup = String(b.supplierId).trim();
    if (!sup || !await one(env, 'SELECT 1 AS x FROM suppliers WHERE id = ?', sup)) return fail('VALIDATION', 'Unknown supplier.', 422, { supplierId: 'Unknown supplier.' });
    sets.push('supplier_id = ?'); args.push(sup);
  }
  if (b.poDate !== undefined) { sets.push('po_date = ?'); args.push(strOrNull(b.poDate) ?? mytToday()); }
  if (b.expectedAt !== undefined) { sets.push('expected_at = ?'); args.push(strOrNull(b.expectedAt)); }
  if (b.warehouseId !== undefined) { sets.push('warehouse_id = ?'); args.push(strOrNull(b.warehouseId)); }
  if (b.currency !== undefined) { sets.push('currency = ?'); args.push(strOrNull(b.currency) ?? 'MYR'); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }

  let subtotal = cur.subtotal_sen;
  if (b.lines !== undefined) {
    const lines = normalizeLines(b.lines);
    if (!lines.length) return fail('VALIDATION', 'A purchase order needs at least one line.', 422, { lines: 'Add at least one line.' });
    await run(env, 'DELETE FROM purchase_order_lines WHERE purchase_order_id = ?', id);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await run(env, `INSERT INTO purchase_order_lines (id, purchase_order_id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, received_qty, notes)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        genId('pol'), id, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.discountSen, l.lineTotalSen, l.notes);
    }
    subtotal = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  }
  const tax = b.taxSen !== undefined ? Math.max(0, intOrNull(b.taxSen) ?? 0) : cur.tax_sen;
  const totals = { subtotalSen: subtotal, taxSen: tax, totalSen: subtotal + tax };
  sets.push('subtotal_sen = ?', 'tax_sen = ?', 'total_sen = ?'); args.push(totals.subtotalSen, totals.taxSen, totals.totalSen);
  sets.push('updated_at = ?'); args.push(now);
  args.push(id);
  await run(env, `UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_order.update', entityTable: 'purchase_orders', entityId: id, after: { total: totals.totalSen } });
  return json({ id });
};

/** DELETE /api/purchase-orders/:id — only while SUBMITTED (lines cascade). */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete purchase orders.', 403);

  const id = String(params.id);
  const cur = await one<{ po_number: string; status: string }>(env, 'SELECT po_number, status FROM purchase_orders WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That purchase order does not exist.', 404);
  if (cur.status !== 'SUBMITTED') return fail('CONFLICT', 'Only a submitted purchase order can be deleted. Cancel it instead.', 409);
  await run(env, 'DELETE FROM purchase_orders WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_order.delete', entityTable: 'purchase_orders', entityId: id, before: { poNumber: cur.po_number } });
  return new Response(null, { status: 204 });
};
