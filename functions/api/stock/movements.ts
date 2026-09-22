import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { toMovementPayload, type MovementRow } from '../../_lib/stock';

/** GET /api/stock/movements?itemCode=&warehouseId= — the movement ledger, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const itemCode = (url.searchParams.get('itemCode') ?? '').trim();
  const warehouseId = url.searchParams.get('warehouseId');

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (itemCode) { where.push('lower(m.item_code) LIKE ?'); args.push(`%${itemCode.toLowerCase()}%`); }
  if (warehouseId) { where.push('m.warehouse_id = ?'); args.push(warehouseId); }

  const rows = await all<MovementRow>(env, `
    SELECT m.id, m.item_code, m.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
           m.qty_delta, m.movement_type, m.ref_type, m.ref_id, m.note, m.moved_at
    FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.moved_at DESC, m.created_at DESC
    LIMIT 500`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toMovementPayload) });
};
