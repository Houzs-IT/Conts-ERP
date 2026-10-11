import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { fieldOwnsRepair, issueParts } from '../../../../_lib/maintenanceTemplates';

/** GET /api/maintenance/issues/:id/parts — the parts planned for the job (from its template) and the parts used. No prices. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  if (!(await one(env, 'SELECT 1 AS x FROM maintenance_issues WHERE id = ?', id))) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (!(await fieldOwnsRepair(env, session, id))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  return json({ data: await issueParts(env, id) });
};

/** POST /api/maintenance/issues/:id/parts { skuId, usedQty } — how many of a catalog part the job used, in total.
 *  A stocked part moves the difference out of (or back into) the parts store, refused if the store has too few. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (typeof b?.skuId !== 'string' || !b.skuId) return fail('VALIDATION', 'Pick the part.', 422, { skuId: 'Pick a part from the catalog.' });
  const used = b?.usedQty;
  if (!Number.isInteger(used) || used < 0 || used > 999) return fail('VALIDATION', 'Enter how many were used, a whole number from 0 to 999.', 422, { usedQty: 'A whole number from 0 to 999.' });

  const issue = await one<{ id: string; state: string }>(env, 'SELECT id, state FROM maintenance_issues WHERE id = ?', id);
  if (!issue) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (!(await fieldOwnsRepair(env, session, id))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (issue.state === 'resolved') return fail('CONFLICT', 'That job is finished. Reopen it to change the parts.', 409);
  const sku = await one<{ id: string; name: string; track_stock: number; active: number }>(env, 'SELECT id, name, track_stock, active FROM maintenance_skus WHERE id = ?', b.skuId);
  if (!sku) return fail('NOT_FOUND', 'That part is no longer in the catalog.', 404, { skuId: 'Pick a part from the catalog.' });

  const cur = await one<{ used_qty: number }>(env, 'SELECT used_qty FROM maintenance_issue_parts WHERE issue_id = ? AND sku_id = ?', id, sku.id);
  if (!cur && !sku.active) return fail('VALIDATION', 'That part is no longer used. Pick another.', 422, { skuId: 'Pick an active part.' });
  const before = Number(cur?.used_qty ?? 0);
  const delta = used - before;
  if (delta === 0 && cur) return json({ data: await issueParts(env, id) });

  const now = nowIso();
  const outcome = await transaction(env, async tx => {
    if (sku.track_stock && delta !== 0) {
      // Taken only if the store still holds it, so two phones cannot draw the same last part.
      const left = await one<{ stock_on_hand: number }>(tx, `UPDATE maintenance_skus SET stock_on_hand = stock_on_hand - ?, updated_at = ? WHERE id = ? AND stock_on_hand >= ? RETURNING stock_on_hand`,
        delta, now, sku.id, Math.max(delta, 0));
      if (!left) return 'short' as const;
      await run(tx, `INSERT INTO maintenance_stock_moves (id, sku_id, issue_id, qty, reason, moved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), sku.id, id, -delta, delta > 0 ? 'used' : 'returned', session.userId, now);
    }
    await run(tx, `
      INSERT INTO maintenance_issue_parts (id, issue_id, sku_id, planned_qty, used_qty, updated_by, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT (issue_id, sku_id) DO UPDATE SET used_qty = EXCLUDED.used_qty, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      `${id}-${sku.id}`, id, sku.id, used, session.userId, now);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.parts_used', entityTable: 'maintenance_issues', entityId: id, before: { label: sku.name, quantity: before }, after: { label: sku.name, quantity: used } });
    return 'ok' as const;
  });
  if (outcome === 'short') {
    const s = await one<{ stock_on_hand: number }>(env, 'SELECT stock_on_hand FROM maintenance_skus WHERE id = ?', sku.id);
    return fail('OUT_OF_STOCK', `Only ${s?.stock_on_hand ?? 0} more in the parts store. Tell the office.`, 409, { usedQty: `Only ${s?.stock_on_hand ?? 0} more in the store.` });
  }
  return json({ data: await issueParts(env, id) });
};
