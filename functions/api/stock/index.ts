import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { toOnHandPayload, type OnHandRow } from '../../_lib/stock';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

/** GET /api/stock?warehouseId=&search= — on-hand per item + warehouse (running sum of moves). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const warehouseId = url.searchParams.get('warehouseId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (warehouseId) { where.push('m.warehouse_id = ?'); args.push(warehouseId); }
  if (search) { where.push('lower(m.item_code) LIKE ?'); args.push(`%${search.toLowerCase()}%`); }

  const rows = await all<OnHandRow>(env, `
    SELECT m.item_code, m.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
           SUM(m.qty_delta) AS on_hand, (SELECT p.name FROM products p WHERE p.code = m.item_code) AS item_name
    FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id
    WHERE ${where.join(' AND ')}
    GROUP BY m.item_code, m.warehouse_id, w.code, w.name
    HAVING SUM(m.qty_delta) <> 0
    ORDER BY m.item_code`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toOnHandPayload) });
};

/** POST /api/stock { itemCode, warehouseId, qtyDelta, note } — a manual stock adjustment. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can adjust stock.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const itemCode = String(b.itemCode ?? '').trim();
  const warehouseId = String(b.warehouseId ?? '').trim();
  const qtyDelta = intOrNull(b.qtyDelta) ?? 0;
  if (!itemCode) return fail('VALIDATION', 'Enter an item code.', 422, { itemCode: 'Enter an item code.' });
  if (!warehouseId || !await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', warehouseId)) return fail('VALIDATION', 'Pick a warehouse.', 422, { warehouseId: 'Unknown warehouse.' });
  if (qtyDelta === 0) return fail('VALIDATION', 'Enter a non-zero quantity change.', 422, { qtyDelta: 'Enter a quantity.' });

  const id = genId('mv');
  const now = nowIso();
  await run(env, `INSERT INTO stock_movements (id, item_code, warehouse_id, qty_delta, movement_type, ref_type, ref_id, note, moved_at, created_by, created_at)
                  VALUES (?, ?, ?, ?, 'ADJUSTMENT', 'ADJ', ?, ?, ?, ?, ?)`,
    id, itemCode, warehouseId, qtyDelta, id, strOrNull(b.note), now.slice(0, 10), session.userId, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'stock.adjust', entityTable: 'stock_movements', entityId: id, after: { itemCode, warehouseId, qtyDelta } });
  return json({ id }, 201);
};
