import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { isDoStatus, nextDoNumber, maybeMarkSoDelivered, toDoHeaderPayload, type DoHeaderRow } from '../../_lib/delivery-orders';
import { postStockMovement } from '../../_lib/stock-ops';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const LIST_SQL = `
  SELECT d.id, d.do_number, d.sales_order_id, d.customer_name, d.do_date, d.expected_delivery_at, d.status,
         d.driver_name, d.vehicle, d.address1, d.city, d.state, d.postcode, d.phone, d.notes, d.warehouse_id, d.created_at, d.updated_at,
         so.doc_no AS so_doc_no, w.name AS warehouse_name
  FROM delivery_orders d
  LEFT JOIN sales_orders so ON so.id = d.sales_order_id
  LEFT JOIN warehouses w ON w.id = d.warehouse_id`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const salesOrderId = url.searchParams.get('salesOrderId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isDoStatus(status)) { where.push('d.status = ?'); args.push(status); }
  if (salesOrderId) { where.push('d.sales_order_id = ?'); args.push(salesOrderId); }
  if (search) { where.push('(lower(d.do_number) LIKE ? OR lower(d.customer_name) LIKE ? OR lower(coalesce(so.doc_no, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<DoHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY d.do_date DESC, d.do_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toDoHeaderPayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise delivery orders.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const soId = String(b.salesOrderId ?? '').trim();
  const so = await one<{ id: string; customer_name: string; status: string }>(env, 'SELECT id, customer_name, status FROM sales_orders WHERE id = ?', soId);
  if (!so) return fail('VALIDATION', 'Pick a sales order.', 422, { salesOrderId: 'Unknown sales order.' });
  if (so.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled sales order cannot be delivered.', 409);

  // Optional dispatch warehouse — when set, delivered qty leaves the stock ledger.
  const warehouseId = strOrNull(b.warehouseId);
  if (warehouseId && !await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', warehouseId)) return fail('VALIDATION', 'Unknown warehouse.', 422, { warehouseId: 'Unknown warehouse.' });

  const raw = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const lines = raw.map(l => {
    const qty = Math.max(0, intOrNull(l.qty) ?? 0);
    const unitPriceSen = Math.max(0, intOrNull(l.unitPriceSen) ?? 0);
    return { soLineId: strOrNull(l.salesOrderLineId), itemCode: String(l.itemCode ?? '').trim(), description: String(l.description ?? '').trim(), uom: String(l.uom ?? 'UNIT').trim() || 'UNIT', qty, unitPriceSen, lineTotalSen: qty * unitPriceSen };
  }).filter(l => l.itemCode && l.description && l.qty > 0);
  if (!lines.length) return fail('VALIDATION', 'Deliver at least one line with a quantity.', 422, { lines: 'Enter a delivery quantity.' });

  const id = genId('do');
  const doNumber = await nextDoNumber(env);
  const now = nowIso();
  const doDate = strOrNull(b.doDate) ?? now.slice(0, 10);
  await run(env, `INSERT INTO delivery_orders (id, do_number, sales_order_id, customer_name, do_date, expected_delivery_at, status,
      driver_name, vehicle, address1, city, state, postcode, phone, notes, warehouse_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'LOADED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, doNumber, soId, so.customer_name, doDate, strOrNull(b.expectedDeliveryAt),
    strOrNull(b.driverName), strOrNull(b.vehicle), strOrNull(b.address1), strOrNull(b.city), strOrNull(b.state), strOrNull(b.postcode), strOrNull(b.phone), strOrNull(b.notes), warehouseId, session.userId, now, now);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `INSERT INTO delivery_order_lines (id, delivery_order_id, sales_order_line_id, line_no, item_code, description, uom, qty, unit_price_sen, line_total_sen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      genId('dol'), id, l.soLineId, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.lineTotalSen);
    if (l.soLineId) await run(env, 'UPDATE sales_order_lines SET delivered_qty = delivered_qty + ? WHERE id = ? AND sales_order_id = ?', l.qty, l.soLineId, soId);
    // Delivered goods leave the dispatch warehouse (negative movement).
    if (warehouseId && l.qty > 0) await postStockMovement(env, { itemCode: l.itemCode, warehouseId, qtyDelta: -l.qty, movementType: 'ISSUE', refType: 'DO', refId: id, note: doNumber, movedAt: doDate, createdBy: session.userId });
  }
  await maybeMarkSoDelivered(env, soId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_order.create', entityTable: 'delivery_orders', entityId: id, after: { doNumber, soId } });
  return json({ id, doNumber }, 201);
};
