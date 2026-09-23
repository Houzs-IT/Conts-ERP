import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { isAmendStatus, isAmendAction, nextAmendmentNumber, toAmendHeaderPayload, type AmendHeaderRow } from '../../_lib/so-amendments';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const LIST_SQL = `
  SELECT a.id, a.amendment_no, a.sales_order_id, a.so_doc_no, a.status, a.reason, a.requested_by, a.applied_at, a.created_at, a.updated_at,
         so.customer_name, so.status AS so_status
  FROM so_amendments a JOIN sales_orders so ON so.id = a.sales_order_id`;

/** GET /api/so-amendments?salesOrderId=&status=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const soId = url.searchParams.get('salesOrderId');
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (soId) { where.push('a.sales_order_id = ?'); args.push(soId); }
  if (isAmendStatus(status)) { where.push('a.status = ?'); args.push(status); }
  if (search) { where.push('(lower(a.amendment_no) LIKE ? OR lower(a.so_doc_no) LIKE ? OR lower(so.customer_name) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }
  const rows = await all<AmendHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC, a.amendment_no DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toAmendHeaderPayload) });
};

/** POST /api/so-amendments { salesOrderId, reason?, lines[] }
 *  line: { salesOrderLineId?, action, itemCode, description, uom?, newQty, newUnitPriceSen } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise amendments.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const soId = String(b.salesOrderId ?? '').trim();
  const so = await one<{ id: string; doc_no: string; status: string }>(env, 'SELECT id, doc_no, status FROM sales_orders WHERE id = ?', soId);
  if (!so) return fail('VALIDATION', 'Pick a sales order.', 422, { salesOrderId: 'Unknown sales order.' });
  if (so.status === 'CANCELLED' || so.status === 'CLOSED') return fail('CONFLICT', `A ${so.status.toLowerCase()} sales order cannot be amended.`, 409);

  const raw = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const lines = raw.map(l => ({
    soLineId: strOrNull(l.salesOrderLineId), action: isAmendAction(l.action) ? l.action : 'CHANGE',
    itemCode: String(l.itemCode ?? '').trim(), description: String(l.description ?? '').trim(), uom: String(l.uom ?? 'UNIT').trim() || 'UNIT',
    newQty: Math.max(0, intOrNull(l.newQty) ?? 0), newUnitPriceSen: Math.max(0, intOrNull(l.newUnitPriceSen) ?? 0),
  })).filter(l => l.itemCode && l.description);
  if (!lines.length) return fail('VALIDATION', 'Add at least one line change.', 422, { lines: 'Add a line change.' });

  const id = genId('amd');
  const amendmentNo = await nextAmendmentNumber(env);
  const now = nowIso();
  await run(env, `INSERT INTO so_amendments (id, amendment_no, sales_order_id, so_doc_no, status, reason, requested_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?)`,
    id, amendmentNo, soId, so.doc_no, strOrNull(b.reason), session.userId, now, now);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Snapshot the current SO line values for CHANGE/REMOVE (for display + audit).
    let oldQty: number | null = null, oldPrice: number | null = null;
    if (l.soLineId) { const cur = await one<{ qty: number; unit_price_sen: number }>(env, 'SELECT qty, unit_price_sen FROM sales_order_lines WHERE id = ? AND sales_order_id = ?', l.soLineId, soId); if (cur) { oldQty = cur.qty; oldPrice = cur.unit_price_sen; } }
    await run(env, `INSERT INTO so_amendment_lines (id, amendment_id, sales_order_line_id, action, line_no, item_code, description, uom, old_qty, old_unit_price_sen, new_qty, new_unit_price_sen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      genId('aml'), id, l.soLineId, l.action, i + 1, l.itemCode, l.description, l.uom, oldQty, oldPrice, l.newQty, l.newUnitPriceSen);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'so_amendment.create', entityTable: 'so_amendments', entityId: id, after: { amendmentNo, soId } });
  return json({ id, amendmentNo }, 201);
};
