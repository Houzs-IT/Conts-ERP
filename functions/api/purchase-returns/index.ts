import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { nextReturnNumber, toPretHeaderPayload, type PretHeaderRow } from '../../_lib/purchase-returns';
import { recomputePoStatus } from '../../_lib/goods-receipts';
import { postStockMovement } from '../../_lib/stock-ops';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const LIST_SQL = `
  SELECT pr.id, pr.return_number, pr.purchase_order_id, pr.grn_id, pr.supplier_id, pr.return_date, pr.reason, pr.status,
         pr.credit_note_ref, pr.refund_sen, pr.notes, pr.created_at, pr.updated_at,
         s.code AS supplier_code, s.name AS supplier_name, g.grn_number
  FROM purchase_returns pr JOIN suppliers s ON s.id = pr.supplier_id LEFT JOIN goods_receipts g ON g.id = pr.grn_id`;

/** GET /api/purchase-returns?status=&supplierId=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplierId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (['POSTED', 'COMPLETED', 'CANCELLED'].includes(status ?? '')) { where.push('pr.status = ?'); args.push(status); }
  if (supplierId) { where.push('pr.supplier_id = ?'); args.push(supplierId); }
  if (search) { where.push('(lower(pr.return_number) LIKE ? OR lower(s.name) LIKE ? OR lower(coalesce(g.grn_number, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<PretHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY pr.return_date DESC, pr.return_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toPretHeaderPayload) });
};

/** POST /api/purchase-returns { grnId, returnDate?, reason?, creditNoteRef?, notes?, lines[] } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise purchase returns.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const grnId = String(b.grnId ?? '').trim();
  const grn = await one<{ supplier_id: string; purchase_order_id: string; status: string; warehouse_id: string | null }>(env, 'SELECT supplier_id, purchase_order_id, status, warehouse_id FROM goods_receipts WHERE id = ?', grnId);
  if (!grn) return fail('VALIDATION', 'Pick a goods receipt.', 422, { grnId: 'Unknown goods receipt.' });
  if (grn.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled goods receipt has nothing to return.', 409);

  const raw = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const lines = raw.map(l => {
    const qty = Math.max(0, intOrNull(l.qtyReturned) ?? 0);
    const unitPriceSen = Math.max(0, intOrNull(l.unitPriceSen) ?? 0);
    return { grnLineId: strOrNull(l.grnLineId), itemCode: String(l.itemCode ?? '').trim(), description: String(l.description ?? '').trim(), uom: String(l.uom ?? 'UNIT').trim() || 'UNIT', qty, unitPriceSen, lineTotalSen: qty * unitPriceSen, reason: strOrNull(l.reason) };
  }).filter(l => l.itemCode && l.description && l.qty > 0);
  if (!lines.length) return fail('VALIDATION', 'Return at least one line with a quantity.', 422, { lines: 'Enter a return quantity.' });

  const refund = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  const id = genId('pret');
  const returnNumber = await nextReturnNumber(env);
  const now = nowIso();
  const returnDate = strOrNull(b.returnDate) ?? now.slice(0, 10);

  await run(env, `INSERT INTO purchase_returns (id, return_number, purchase_order_id, grn_id, supplier_id, return_date, reason, status, credit_note_ref, refund_sen, notes, posted_at, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?)`,
    id, returnNumber, grn.purchase_order_id, grnId, grn.supplier_id, returnDate, strOrNull(b.reason), strOrNull(b.creditNoteRef), refund, strOrNull(b.notes), now, session.userId, now, now);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `INSERT INTO purchase_return_lines (id, purchase_return_id, grn_line_id, line_no, item_code, description, uom, qty_returned, unit_price_sen, line_total_sen, reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      genId('prl'), id, l.grnLineId, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.lineTotalSen, l.reason);
    if (l.grnLineId) {
      await run(env, 'UPDATE goods_receipt_lines SET returned_qty = returned_qty + ? WHERE id = ?', l.qty, l.grnLineId);
      const gl = await one<{ purchase_order_line_id: string | null }>(env, 'SELECT purchase_order_line_id FROM goods_receipt_lines WHERE id = ?', l.grnLineId);
      if (gl?.purchase_order_line_id) await run(env, 'UPDATE purchase_order_lines SET received_qty = GREATEST(0, received_qty - ?) WHERE id = ?', l.qty, gl.purchase_order_line_id);
    }
    // Returned goods leave the warehouse they were received into (negative movement).
    if (grn.warehouse_id) await postStockMovement(env, { itemCode: l.itemCode, warehouseId: grn.warehouse_id, qtyDelta: -l.qty, movementType: 'RETURN', refType: 'PRET', refId: id, note: returnNumber, movedAt: returnDate, createdBy: session.userId });
  }
  if (grn.purchase_order_id) await recomputePoStatus(env, grn.purchase_order_id);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_return.create', entityTable: 'purchase_returns', entityId: id, after: { returnNumber, grnId, refund } });
  return json({ id, returnNumber }, 201);
};
