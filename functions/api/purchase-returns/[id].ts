import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { toPretHeaderPayload, toPretLinePayload, type PretHeaderRow, type PretLineRow } from '../../_lib/purchase-returns';
import { recomputePoStatus } from '../../_lib/goods-receipts';
import { postStockMovement } from '../../_lib/stock-ops';

const HEADER_SQL = `
  SELECT pr.id, pr.return_number, pr.purchase_order_id, pr.grn_id, pr.supplier_id, pr.return_date, pr.reason, pr.status,
         pr.credit_note_ref, pr.refund_sen, pr.notes, pr.created_at, pr.updated_at,
         s.code AS supplier_code, s.name AS supplier_name, g.grn_number
  FROM purchase_returns pr JOIN suppliers s ON s.id = pr.supplier_id LEFT JOIN goods_receipts g ON g.id = pr.grn_id WHERE pr.id = ?`;

/** GET /api/purchase-returns/:id — header + lines. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<PretHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That purchase return does not exist.', 404);
  const lines = await all<PretLineRow>(env, 'SELECT id, grn_line_id, line_no, item_code, description, uom, qty_returned, unit_price_sen, line_total_sen, reason FROM purchase_return_lines WHERE purchase_return_id = ? ORDER BY line_no', id);
  return json({ data: { ...toPretHeaderPayload(header), lines: lines.map(toPretLinePayload) } });
};

/** PATCH /api/purchase-returns/:id — COMPLETED (mark done) or CANCELLED (reverses stock effect). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change purchase returns.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; purchase_order_id: string | null; return_number: string; warehouse_id: string | null }>(env,
    'SELECT pr.status, pr.purchase_order_id, pr.return_number, g.warehouse_id FROM purchase_returns pr LEFT JOIN goods_receipts g ON g.id = pr.grn_id WHERE pr.id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That purchase return does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.status === 'COMPLETED') {
    if (cur.status !== 'POSTED') return fail('CONFLICT', 'Only a posted return can be completed.', 409);
    await run(env, 'UPDATE purchase_returns SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?', 'COMPLETED', now, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_return.complete', entityTable: 'purchase_returns', entityId: id });
    return json({ id });
  }

  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id });
    const lines = await all<{ grn_line_id: string | null; item_code: string; qty_returned: number }>(env, 'SELECT grn_line_id, item_code, qty_returned FROM purchase_return_lines WHERE purchase_return_id = ?', id);
    for (const l of lines) {
      if (l.grn_line_id) {
        await run(env, 'UPDATE goods_receipt_lines SET returned_qty = GREATEST(0, returned_qty - ?) WHERE id = ?', l.qty_returned, l.grn_line_id);
        const gl = await one<{ purchase_order_line_id: string | null }>(env, 'SELECT purchase_order_line_id FROM goods_receipt_lines WHERE id = ?', l.grn_line_id);
        if (gl?.purchase_order_line_id) await run(env, 'UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id = ?', l.qty_returned, gl.purchase_order_line_id);
      }
      // Put the returned goods back into the warehouse they left (reverses the RETURN movement).
      if (cur.warehouse_id && l.qty_returned > 0) await postStockMovement(env, { itemCode: l.item_code, warehouseId: cur.warehouse_id, qtyDelta: l.qty_returned, movementType: 'RETURN', refType: 'PRET-REV', refId: id, note: `${cur.return_number} cancelled`, movedAt: now.slice(0, 10), createdBy: session.userId });
    }
    if (cur.purchase_order_id) await recomputePoStatus(env, cur.purchase_order_id);
    await run(env, 'UPDATE purchase_returns SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_return.cancel', entityTable: 'purchase_returns', entityId: id });
    return json({ id });
  }

  return fail('VALIDATION', 'Only COMPLETED or CANCELLED are accepted.', 422);
};
