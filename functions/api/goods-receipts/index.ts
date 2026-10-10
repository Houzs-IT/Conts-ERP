import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { nextGrnNumber, recomputePoStatus, toGrnHeaderPayload, type GrnHeaderRow } from '../../_lib/goods-receipts';
import { postStockMovement } from '../../_lib/stock-ops';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkDate, checkInt, checkSen, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT g.id, g.grn_number, g.purchase_order_id, g.supplier_id, g.received_at, g.delivery_note_ref, g.status, g.notes,
         g.currency, g.subtotal_sen, g.tax_sen, g.total_sen, g.posted_at, g.warehouse_id, g.created_at, g.updated_at,
         po.po_number, s.code AS supplier_code, s.name AS supplier_name, w.name AS warehouse_name
  FROM goods_receipts g
  JOIN purchase_orders po ON po.id = g.purchase_order_id
  JOIN suppliers s ON s.id = g.supplier_id
  LEFT JOIN warehouses w ON w.id = g.warehouse_id`;

/** GET /api/goods-receipts?status=&purchaseOrderId=&search= — headers, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const poId = url.searchParams.get('purchaseOrderId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (status === 'POSTED' || status === 'CLOSED' || status === 'CANCELLED') { where.push('g.status = ?'); args.push(status); }
  if (poId) { where.push('g.purchase_order_id = ?'); args.push(poId); }
  if (search) { where.push('(lower(g.grn_number) LIKE ? OR lower(po.po_number) LIKE ? OR lower(s.name) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<GrnHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY g.received_at DESC, g.grn_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toGrnHeaderPayload) });
};

/** POST /api/goods-receipts { purchaseOrderId, receivedAt?, deliveryNoteRef?, notes?, lines[] }
 *  Each line: { purchaseOrderLineId?, itemCode, description, uom?, unitPriceSen, qtyReceived, qtyAccepted?, qtyRejected?, rejectionReason? } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can receive goods.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkDate(fields, 'receivedAt', b.receivedAt, { label: 'Received date' });
  if (Array.isArray(b.lines)) (b.lines as Record<string, unknown>[]).forEach((l, i) => {
    checkInt(fields, `lines.${i}.qtyReceived`, l?.qtyReceived, { label: 'Received quantity', min: 0 });
    checkInt(fields, `lines.${i}.qtyAccepted`, l?.qtyAccepted, { label: 'Accepted quantity', min: 0 });
    checkSen(fields, `lines.${i}.unitPriceSen`, l?.unitPriceSen, { label: 'Unit price' });
  });
  const bad = invalid(fields); if (bad) return bad;
  const poId = String(b.purchaseOrderId ?? '').trim();
  const po = await one<{ id: string; supplier_id: string; status: string }>(env, 'SELECT id, supplier_id, status FROM purchase_orders WHERE id = ?', poId);
  if (!po) return fail('VALIDATION', 'Pick a purchase order.', 422, { purchaseOrderId: 'Unknown purchase order.' });
  if (po.status === 'CANCELLED' || po.status === 'RECEIVED') return fail('CONFLICT', `That purchase order is ${po.status.toLowerCase()} and cannot receive more.`, 409);

  // Optional receiving warehouse — when set, accepted qty posts to the stock ledger.
  const warehouseId = strOrNull(b.warehouseId);
  if (warehouseId && !await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', warehouseId)) return fail('VALIDATION', 'Unknown warehouse.', 422, { warehouseId: 'Unknown warehouse.' });

  const rawLines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const lines = rawLines.map(l => {
    const qtyReceived = Math.max(0, intOrNull(l.qtyReceived) ?? 0);
    const qtyAccepted = Math.max(0, Math.min(qtyReceived, intOrNull(l.qtyAccepted) ?? qtyReceived));
    const unitPriceSen = Math.max(0, intOrNull(l.unitPriceSen) ?? 0);
    return {
      poLineId: strOrNull(l.purchaseOrderLineId), itemCode: String(l.itemCode ?? '').trim(), description: String(l.description ?? '').trim(),
      uom: String(l.uom ?? 'UNIT').trim() || 'UNIT', qtyReceived, qtyAccepted, qtyRejected: Math.max(0, qtyReceived - qtyAccepted),
      rejectionReason: strOrNull(l.rejectionReason), unitPriceSen, lineTotalSen: qtyAccepted * unitPriceSen,
    };
  }).filter(l => l.itemCode && l.description && l.qtyReceived > 0);

  if (!lines.length) return fail('VALIDATION', 'Receive at least one line with a quantity.', 422, { lines: 'Enter a received quantity.' });

  const id = genId('grn');
  const grnNumber = await nextGrnNumber(env);
  const now = nowIso();
  const receivedAt = strOrNull(b.receivedAt) ?? now.slice(0, 10);
  const subtotal = lines.reduce((s, l) => s + l.lineTotalSen, 0);

  await run(env, `
    INSERT INTO goods_receipts (id, grn_number, purchase_order_id, supplier_id, received_at, delivery_note_ref, status, notes,
      currency, subtotal_sen, tax_sen, total_sen, posted_at, warehouse_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, 'MYR', ?, 0, ?, ?, ?, ?, ?, ?)`,
    id, grnNumber, poId, po.supplier_id, receivedAt, strOrNull(b.deliveryNoteRef), strOrNull(b.notes), subtotal, subtotal, now, warehouseId, session.userId, now, now);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `
      INSERT INTO goods_receipt_lines (id, grn_id, purchase_order_line_id, line_no, item_code, description, uom,
        qty_received, qty_accepted, qty_rejected, rejection_reason, unit_price_sen, line_total_sen, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      genId('grl'), id, l.poLineId, i + 1, l.itemCode, l.description, l.uom, l.qtyReceived, l.qtyAccepted, l.qtyRejected, l.rejectionReason, l.unitPriceSen, l.lineTotalSen);
    if (l.poLineId) await run(env, 'UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id = ? AND purchase_order_id = ?', l.qtyAccepted, l.poLineId, poId);
    // Accepted goods land in the receiving warehouse (positive movement).
    if (warehouseId && l.qtyAccepted > 0) await postStockMovement(env, { itemCode: l.itemCode, warehouseId, qtyDelta: l.qtyAccepted, movementType: 'RECEIPT', refType: 'GRN', refId: id, note: grnNumber, movedAt: receivedAt, createdBy: session.userId });
  }

  await recomputePoStatus(env, poId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'grn.create', entityTable: 'goods_receipts', entityId: id, after: { grnNumber, poId, total: subtotal } });
  return json({ id, grnNumber }, 201);
};
