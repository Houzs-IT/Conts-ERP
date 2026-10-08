import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { recomputeSoTotals, toAmendHeaderPayload, toAmendLinePayload, type AmendHeaderRow, type AmendLineRow } from '../../_lib/so-amendments';
import { genId } from '../../_lib/scm-util';

const HEADER_SQL = `
  SELECT a.id, a.amendment_no, a.sales_order_id, a.so_doc_no, a.status, a.reason, a.requested_by, a.applied_at, a.created_at, a.updated_at,
         so.customer_name, so.status AS so_status
  FROM so_amendments a JOIN sales_orders so ON so.id = a.sales_order_id WHERE a.id = ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<AmendHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That amendment does not exist.', 404);
  const lines = await all<AmendLineRow>(env, 'SELECT id, sales_order_line_id, action, line_no, item_code, description, uom, old_qty, old_unit_price_sen, new_qty, new_unit_price_sen FROM so_amendment_lines WHERE amendment_id = ? ORDER BY line_no', id);
  return json({ data: { ...toAmendHeaderPayload(header), lines: lines.map(toAmendLinePayload) } });
};

/** PATCH { action: approve | reject | cancel | apply } */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change amendments.', 403);
  const id = String(params.id);
  const cur = await one<{ status: string; sales_order_id: string; amendment_no: string }>(env, 'SELECT status, sales_order_id, amendment_no FROM so_amendments WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That amendment does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const action = String(b.action ?? '');
  const now = nowIso();

  if (action === 'approve') {
    if (cur.status !== 'REQUESTED') return fail('CONFLICT', 'Only a requested amendment can be approved.', 409);
    await run(env, 'UPDATE so_amendments SET status = ?, updated_at = ? WHERE id = ?', 'APPROVED', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'so_amendment.approve', entityTable: 'so_amendments', entityId: id });
    return json({ id, status: 'APPROVED' });
  }
  if (action === 'reject' || action === 'cancel') {
    if (cur.status === 'APPLIED' || cur.status === 'REJECTED' || cur.status === 'CANCELLED') return fail('CONFLICT', `A ${cur.status.toLowerCase()} amendment cannot be ${action}ed.`, 409);
    const next = action === 'reject' ? 'REJECTED' : 'CANCELLED';
    await run(env, 'UPDATE so_amendments SET status = ?, updated_at = ? WHERE id = ?', next, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `so_amendment.${action}`, entityTable: 'so_amendments', entityId: id });
    return json({ id, status: next });
  }
  if (action === 'apply') {
    if (cur.status !== 'APPROVED') return fail('CONFLICT', 'Only an approved amendment can be applied.', 409);
    const soId = cur.sales_order_id;
    const lines = await all<AmendLineRow>(env, 'SELECT id, sales_order_line_id, action, item_code, description, uom, new_qty, new_unit_price_sen FROM so_amendment_lines WHERE amendment_id = ? ORDER BY line_no', id);
    // Guard first — an amendment must not silently drop below what is already delivered.
    for (const l of lines) {
      if (l.sales_order_line_id && (l.action === 'CHANGE' || l.action === 'REMOVE')) {
        const so = await one<{ delivered_qty: number; discount_sen: number }>(env, 'SELECT delivered_qty, discount_sen FROM sales_order_lines WHERE id = ? AND sales_order_id = ?', l.sales_order_line_id, soId);
        if (!so) continue;
        const target = l.action === 'REMOVE' ? 0 : l.new_qty;
        if (target < so.delivered_qty) return fail('CONFLICT', `Cannot apply: ${l.item_code} would drop below its delivered quantity (${so.delivered_qty}).`, 409, { lines: `${l.item_code} is already delivered ${so.delivered_qty}.` });
      }
    }
    for (const l of lines) {
      if (l.action === 'REMOVE' && l.sales_order_line_id) {
        await run(env, 'DELETE FROM sales_order_lines WHERE id = ? AND sales_order_id = ?', l.sales_order_line_id, soId);
      } else if (l.action === 'ADD') {
        await run(env, `INSERT INTO sales_order_lines (id, sales_order_id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, delivered_qty)
                        VALUES (?, ?, (SELECT COALESCE(MAX(line_no),0)+1 FROM sales_order_lines WHERE sales_order_id = ?), ?, ?, ?, ?, ?, 0, ?, 0)`,
          genId('sol'), soId, soId, l.item_code, l.description, l.uom, l.new_qty, l.new_unit_price_sen, l.new_qty * l.new_unit_price_sen);
      } else if (l.sales_order_line_id) {
        const so = await one<{ discount_sen: number }>(env, 'SELECT discount_sen FROM sales_order_lines WHERE id = ?', l.sales_order_line_id);
        const discount = so?.discount_sen ?? 0;
        await run(env, 'UPDATE sales_order_lines SET qty = ?, unit_price_sen = ?, line_total_sen = ? WHERE id = ? AND sales_order_id = ?',
          l.new_qty, l.new_unit_price_sen, Math.max(0, l.new_qty * l.new_unit_price_sen - discount), l.sales_order_line_id, soId);
      }
    }
    await recomputeSoTotals(env, soId);
    await run(env, 'UPDATE so_amendments SET status = ?, applied_at = ?, updated_at = ? WHERE id = ?', 'APPLIED', now, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'so_amendment.apply', entityTable: 'so_amendments', entityId: id, after: { soId, lines: lines.length } });
    return json({ id, status: 'APPLIED' });
  }
  return fail('VALIDATION', 'Use action = approve | reject | cancel | apply.', 422);
};
