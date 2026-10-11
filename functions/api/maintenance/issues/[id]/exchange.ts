import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';

/** POST /api/maintenance/issues/:id/exchange { skuId, qty } — draw a part from the maintenance
 *  parts store for this job. Decrements the SKU's stock_on_hand and records a stock move. This
 *  moves stock only; it does not touch the job's cost — the SKU's selling price already flows
 *  through the quote → complete → expense loop. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot draw from stock here.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const qty = b?.qty;
  if (!Number.isInteger(qty) || qty <= 0) return fail('VALIDATION', 'Say how many to draw.', 422, { qty: 'Enter a whole number.' });
  if (!b?.skuId) return fail('VALIDATION', 'Pick the part to draw.', 422, { skuId: 'Pick a stocked item.' });

  const issue = await one<any>(env, 'SELECT id, state FROM maintenance_issues WHERE id = ?', id);
  if (!issue) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (issue.state === 'resolved') return fail('CONFLICT', 'That job is already finished.', 409);

  const sku = await one<any>(env, 'SELECT id, name, track_stock, stock_on_hand FROM maintenance_skus WHERE id = ?', String(b.skuId));
  if (!sku) return fail('NOT_FOUND', 'That catalog item does not exist.', 404, { skuId: 'Pick a catalog item that exists.' });
  if (!sku.track_stock) return fail('CONFLICT', 'That item is not stocked, so there is nothing to draw.', 409, { skuId: 'This item is not stock-tracked.' });
  if (sku.stock_on_hand < qty) return fail('OUT_OF_STOCK', `Only ${sku.stock_on_hand} in stock.`, 409, { qty: `Only ${sku.stock_on_hand} left.` });

  const now = nowIso();
  // Decrement only if the stock is still there — guards against two draws racing the same units.
  // No row back means another draw took the stock first: nothing moved, so no stock move is recorded either.
  const after = await one<{ stock_on_hand: number }>(env, 'UPDATE maintenance_skus SET stock_on_hand = stock_on_hand - ?, updated_at = ? WHERE id = ? AND stock_on_hand >= ? RETURNING stock_on_hand', qty, now, sku.id, qty);
  if (!after) return fail('OUT_OF_STOCK', 'That part just went out of stock. Try again.', 409);

  const moveId = crypto.randomUUID();
  await run(env, `
    INSERT INTO maintenance_stock_moves (id, sku_id, issue_id, inventory_item_id, qty, reason, moved_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'exchange', ?, ?)`,
    moveId, sku.id, id, b.inventoryItemId ?? null, -qty, session.userId, now);
  // The part drawn counts as used on the job, so the technician's parts list matches the store.
  await run(env, `
    INSERT INTO maintenance_issue_parts (id, issue_id, sku_id, planned_qty, used_qty, updated_by, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT (issue_id, sku_id) DO UPDATE SET used_qty = maintenance_issue_parts.used_qty + EXCLUDED.used_qty, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    `${id}-${sku.id}`, id, sku.id, qty, session.userId, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.exchange', entityTable: 'maintenance_issues', entityId: id, after: { label: sku.name, quantity: qty, stockOnHand: after.stock_on_hand, moveId } });
  return json({ ok: true, stockOnHand: after.stock_on_hand }, 201);
};
