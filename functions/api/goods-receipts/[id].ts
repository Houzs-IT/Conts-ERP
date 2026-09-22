import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { recomputePoStatus, toGrnHeaderPayload, toGrnLinePayload, type GrnHeaderRow, type GrnLineRow } from '../../_lib/goods-receipts';

const HEADER_SQL = `
  SELECT g.id, g.grn_number, g.purchase_order_id, g.supplier_id, g.received_at, g.delivery_note_ref, g.status, g.notes,
         g.currency, g.subtotal_sen, g.tax_sen, g.total_sen, g.posted_at, g.created_at, g.updated_at,
         po.po_number, s.code AS supplier_code, s.name AS supplier_name
  FROM goods_receipts g
  JOIN purchase_orders po ON po.id = g.purchase_order_id
  JOIN suppliers s ON s.id = g.supplier_id WHERE g.id = ?`;

/** GET /api/goods-receipts/:id — header + lines. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<GrnHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That goods receipt does not exist.', 404);
  const lines = await all<GrnLineRow>(env, `SELECT id, purchase_order_line_id, line_no, item_code, description, uom, qty_received, qty_accepted,
    qty_rejected, rejection_reason, unit_price_sen, line_total_sen, invoiced_qty, notes FROM goods_receipt_lines WHERE grn_id = ? ORDER BY line_no`, id);
  return json({ data: { ...toGrnHeaderPayload(header), lines: lines.map(toGrnLinePayload) } });
};

/** PATCH /api/goods-receipts/:id — CANCELLED (reverses received_qty) or CLOSED. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change goods receipts.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; purchase_order_id: string }>(env, 'SELECT status, purchase_order_id FROM goods_receipts WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That goods receipt does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id });
    // Reverse the received_qty this GRN added, then recompute the PO status.
    const lines = await all<{ purchase_order_line_id: string | null; qty_accepted: number }>(env, 'SELECT purchase_order_line_id, qty_accepted FROM goods_receipt_lines WHERE grn_id = ?', id);
    for (const l of lines) {
      if (l.purchase_order_line_id) await run(env, 'UPDATE purchase_order_lines SET received_qty = GREATEST(0, received_qty - ?) WHERE id = ?', l.qty_accepted, l.purchase_order_line_id);
    }
    await run(env, 'UPDATE goods_receipts SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
    await recomputePoStatus(env, cur.purchase_order_id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'grn.cancel', entityTable: 'goods_receipts', entityId: id });
    return json({ id });
  }

  if (b.status === 'CLOSED') {
    if (cur.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled goods receipt cannot be closed.', 409);
    await run(env, 'UPDATE goods_receipts SET status = ?, updated_at = ? WHERE id = ?', 'CLOSED', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'grn.close', entityTable: 'goods_receipts', entityId: id });
    return json({ id });
  }

  return fail('VALIDATION', 'Only CANCELLED or CLOSED are accepted.', 422);
};
