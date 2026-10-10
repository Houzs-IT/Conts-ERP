import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { normalizeLines, toPcHeaderPayload, toPcLinePayload, checkPricedBody, type PcHeaderRow, type PcLineRow } from '../../_lib/purchase-consignment';
import { invalid, type Fields } from '../../_lib/validate';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const HEADER_SQL = `
  SELECT pc.id, pc.pc_number, pc.supplier_id, pc.status, pc.pc_date, pc.expected_at, pc.warehouse_id, pc.currency,
         pc.subtotal_sen, pc.tax_sen, pc.total_sen, pc.notes, pc.submitted_at, pc.cancelled_at, pc.created_at, pc.updated_at,
         s.code AS supplier_code, s.name AS supplier_name
  FROM pc_orders pc JOIN suppliers s ON s.id = pc.supplier_id WHERE pc.id = ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<PcHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That consignment order does not exist.', 404);
  const lines = await all<PcLineRow>(env, 'SELECT id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, received_qty, notes FROM pc_order_lines WHERE pc_order_id = ? ORDER BY line_no', id);
  return json({ data: { ...toPcHeaderPayload(header), lines: lines.map(toPcLinePayload) } });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change consignment orders.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; subtotal_sen: number; tax_sen: number }>(env, 'SELECT status, subtotal_sen, tax_sen FROM pc_orders WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That consignment order does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id });
    if (cur.status === 'RECEIVED') return fail('CONFLICT', 'A received consignment order cannot be cancelled.', 409);
    await run(env, 'UPDATE pc_orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'pc_order.cancel', entityTable: 'pc_orders', entityId: id });
    return json({ id });
  }
  if (b.status !== undefined) return fail('VALIDATION', 'Receiving statuses are set by consignment receipts.', 422);
  if (cur.status !== 'SUBMITTED') return fail('CONFLICT', 'Only a submitted consignment order can be edited.', 409);

  const fields: Fields = {};
  checkPricedBody(fields, b, 'pcDate', 'PC date');
  const bad = invalid(fields); if (bad) return bad;

  const sets: string[] = [];
  const args: unknown[] = [];
  if (b.supplierId !== undefined) { const sup = String(b.supplierId).trim(); if (!sup || !await one(env, 'SELECT 1 AS x FROM suppliers WHERE id = ?', sup)) return fail('VALIDATION', 'Unknown supplier.', 422, { supplierId: 'Unknown supplier.' }); sets.push('supplier_id = ?'); args.push(sup); }
  if (b.pcDate !== undefined) { sets.push('pc_date = ?'); args.push(strOrNull(b.pcDate) ?? now.slice(0, 10)); }
  if (b.expectedAt !== undefined) { sets.push('expected_at = ?'); args.push(strOrNull(b.expectedAt)); }
  if (b.warehouseId !== undefined) { sets.push('warehouse_id = ?'); args.push(strOrNull(b.warehouseId)); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }

  let subtotal = cur.subtotal_sen;
  if (b.lines !== undefined) {
    const lines = normalizeLines(b.lines);
    if (!lines.length) return fail('VALIDATION', 'A consignment order needs at least one line.', 422, { lines: 'Add at least one line.' });
    await run(env, 'DELETE FROM pc_order_lines WHERE pc_order_id = ?', id);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await run(env, `INSERT INTO pc_order_lines (id, pc_order_id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, received_qty, notes)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        genId('pcl'), id, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.discountSen, l.lineTotalSen, l.notes);
    }
    subtotal = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  }
  const tax = b.taxSen !== undefined ? Math.max(0, intOrNull(b.taxSen) ?? 0) : cur.tax_sen;
  sets.push('subtotal_sen = ?', 'tax_sen = ?', 'total_sen = ?'); args.push(subtotal, tax, subtotal + tax);
  sets.push('updated_at = ?'); args.push(now);
  args.push(id);
  await run(env, `UPDATE pc_orders SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'pc_order.update', entityTable: 'pc_orders', entityId: id, after: { total: subtotal + tax } });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete consignment orders.', 403);
  const id = String(params.id);
  const cur = await one<{ pc_number: string; status: string }>(env, 'SELECT pc_number, status FROM pc_orders WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That consignment order does not exist.', 404);
  if (cur.status !== 'SUBMITTED') return fail('CONFLICT', 'Only a submitted consignment order can be deleted.', 409);
  await run(env, 'DELETE FROM pc_orders WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'pc_order.delete', entityTable: 'pc_orders', entityId: id, before: { pcNumber: cur.pc_number } });
  return new Response(null, { status: 204 });
};
