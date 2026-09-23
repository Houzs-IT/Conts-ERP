import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/loading-list?warehouseId=&date= — the warehouse loading manifest: delivery orders
 *  that are LOADED (packed, ready to dispatch), with what and how much to load. A read-only view
 *  over delivery_orders; 2990 has no standalone Loading List page, so this is the standard
 *  warehouse reading of it, drawn in Conts. */
interface Row {
  id: string; do_number: string; customer_name: string; do_date: string; warehouse_id: string | null;
  warehouse_code: string | null; warehouse_name: string | null; driver_name: string | null; vehicle: string | null;
  line_count: number; total_qty: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const warehouseId = url.searchParams.get('warehouseId');
  const date = url.searchParams.get('date');
  const where: string[] = ["d.status = 'LOADED'"]; const args: unknown[] = [];
  if (warehouseId) { where.push('d.warehouse_id = ?'); args.push(warehouseId); }
  if (date) { where.push('d.do_date = ?'); args.push(date); }

  const rows = await all<Row>(env, `
    SELECT d.id, d.do_number, d.customer_name, d.do_date, d.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
           d.driver_name, d.vehicle,
           (SELECT COUNT(*) FROM delivery_order_lines l WHERE l.delivery_order_id = d.id) AS line_count,
           (SELECT COALESCE(SUM(qty), 0) FROM delivery_order_lines l WHERE l.delivery_order_id = d.id) AS total_qty
    FROM delivery_orders d LEFT JOIN warehouses w ON w.id = d.warehouse_id
    WHERE ${where.join(' AND ')}
    ORDER BY d.do_date ASC, w.name ASC, d.do_number ASC`, ...args);

  const data = rows.map(r => ({
    id: r.id, doNumber: r.do_number, customerName: r.customer_name, doDate: r.do_date,
    warehouseId: r.warehouse_id ?? '', warehouseCode: r.warehouse_code ?? '', warehouseName: r.warehouse_name ?? '',
    driverName: r.driver_name ?? '', vehicle: r.vehicle ?? '', lineCount: r.line_count, totalQty: r.total_qty,
  }));
  return json({ generatedAt: nowIso(), data, totalQty: data.reduce((s, r) => s + r.totalQty, 0) });
};
