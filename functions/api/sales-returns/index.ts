import { type Env, all, one, run, json, fail, nowIso, audit, mytToday, isNumberClash } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isSretStatus, nextSalesReturnNumber, toSretHeaderPayload, type SretHeaderRow } from '../../_lib/sales-returns';
import { postStockMovement } from '../../_lib/stock-ops';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkSen, checkInt, checkDate, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT sr.id, sr.return_number, sr.sales_order_id, sr.delivery_order_id, sr.customer_name, sr.return_date, sr.reason, sr.status,
         sr.credit_note_ref, sr.refund_sen, sr.notes, sr.created_at, sr.updated_at,
         so.doc_no AS so_doc_no, d.do_number
  FROM sales_returns sr
  LEFT JOIN sales_orders so ON so.id = sr.sales_order_id
  LEFT JOIN delivery_orders d ON d.id = sr.delivery_order_id`;

/** GET /api/sales-returns?status=&deliveryOrderId=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const doId = url.searchParams.get('deliveryOrderId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isSretStatus(status)) { where.push('sr.status = ?'); args.push(status); }
  if (doId) { where.push('sr.delivery_order_id = ?'); args.push(doId); }
  if (search) { where.push('(lower(sr.return_number) LIKE ? OR lower(sr.customer_name) LIKE ? OR lower(coalesce(d.do_number, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<SretHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY sr.return_date DESC, sr.return_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toSretHeaderPayload) });
};

/** POST /api/sales-returns { deliveryOrderId, returnDate?, reason?, creditNoteRef?, notes?, lines[] }
 *  Each line: { deliveryOrderLineId?, itemCode, description, uom?, unitPriceSen, qtyReturned } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise sales returns.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkDate(fields, 'returnDate', b.returnDate, { label: 'Return date' });
  if (Array.isArray(b.lines)) (b.lines as Record<string, unknown>[]).forEach((l, i) => {
    checkInt(fields, `lines.${i}.qtyReturned`, l?.qtyReturned, { label: 'Return quantity', min: 0 });
    checkSen(fields, `lines.${i}.unitPriceSen`, l?.unitPriceSen, { label: 'Unit price' });
  });
  const bad = invalid(fields); if (bad) return bad;
  const doId = String(b.deliveryOrderId ?? '').trim();
  const dord = await one<{ id: string; sales_order_id: string | null; customer_name: string; status: string; warehouse_id: string | null }>(env, 'SELECT id, sales_order_id, customer_name, status, warehouse_id FROM delivery_orders WHERE id = ?', doId);
  if (!dord) return fail('VALIDATION', 'Pick a delivery order.', 422, { deliveryOrderId: 'Unknown delivery order.' });
  if (dord.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled delivery order has nothing to return.', 409);

  const raw = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const lines = raw.map(l => {
    const qty = Math.max(0, intOrNull(l.qtyReturned) ?? 0);
    const unitPriceSen = Math.max(0, intOrNull(l.unitPriceSen) ?? 0);
    return { doLineId: strOrNull(l.deliveryOrderLineId), itemCode: String(l.itemCode ?? '').trim(), description: String(l.description ?? '').trim(), uom: String(l.uom ?? 'UNIT').trim() || 'UNIT', qty, unitPriceSen, lineTotalSen: qty * unitPriceSen, reason: strOrNull(l.reason) };
  }).filter(l => l.itemCode && l.description && l.qty > 0);
  if (!lines.length) return fail('VALIDATION', 'Return at least one line with a quantity.', 422, { lines: 'Enter a return quantity.' });

  const refund = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  const id = genId('sret');
  let returnNumber = '';
  const now = nowIso();
  const returnDate = strOrNull(b.returnDate) ?? mytToday();

  // The number is the highest so far plus one, so two made at once can pick the same one: the second header insert
  // then hits the unique number before anything is written, and simply takes the next number (isNumberClash).
  for (let attempt = 1; ; attempt++) {
    returnNumber = await nextSalesReturnNumber(env);
    try {
      await run(env, `INSERT INTO sales_returns (id, return_number, sales_order_id, delivery_order_id, customer_name, return_date, reason, status, credit_note_ref, refund_sen, notes, posted_at, created_by, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?)`,
        id, returnNumber, dord.sales_order_id, doId, dord.customer_name, returnDate, strOrNull(b.reason), strOrNull(b.creditNoteRef), refund, strOrNull(b.notes), now, session.userId, now, now);
      break;
    } catch (e) { if (attempt >= 5 || !isNumberClash(e)) throw e; }
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `INSERT INTO sales_return_lines (id, sales_return_id, delivery_order_line_id, line_no, item_code, description, uom, qty_returned, unit_price_sen, line_total_sen, reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      genId('srl'), id, l.doLineId, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.lineTotalSen, l.reason);
    // Reverse the delivered qty on the sales-order line (goods came back) and mark the DO line returned.
    if (l.doLineId) {
      await run(env, 'UPDATE delivery_order_lines SET returned_qty = returned_qty + ? WHERE id = ?', l.qty, l.doLineId);
      const dl = await one<{ sales_order_line_id: string | null }>(env, 'SELECT sales_order_line_id FROM delivery_order_lines WHERE id = ?', l.doLineId);
      if (dl?.sales_order_line_id) await run(env, 'UPDATE sales_order_lines SET delivered_qty = GREATEST(0, delivered_qty - ?) WHERE id = ?', l.qty, dl.sales_order_line_id);
    }
    // Returned goods come back into the dispatch warehouse (positive movement).
    if (dord.warehouse_id) await postStockMovement(env, { itemCode: l.itemCode, warehouseId: dord.warehouse_id, qtyDelta: l.qty, movementType: 'RETURN', refType: 'SRET', refId: id, note: returnNumber, movedAt: returnDate, createdBy: session.userId });
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_return.create', entityTable: 'sales_returns', entityId: id, after: { returnNumber, doId, refund } });
  return json({ id, returnNumber }, 201);
};
