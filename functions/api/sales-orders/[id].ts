import { type Env, all, one, run, json, fail, nowIso, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { normalizeLines, nextStatus, toSoHeaderPayload, toSoLinePayload, type SoHeaderRow, type SoLineRow } from '../../_lib/sales-orders';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkSen, checkInt, checkDate, checkPhone, invalid, type Fields } from '../../_lib/validate';

const COLS = `id, doc_no, customer_name, customer_phone, customer_po, so_date, target_date, status, currency,
              subtotal_sen, tax_sen, total_sen, deposit_sen, paid_sen, notes, created_at, updated_at`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<SoHeaderRow>(env, `SELECT ${COLS} FROM sales_orders WHERE id = ?`, id);
  if (!header) return fail('NOT_FOUND', 'That sales order does not exist.', 404);
  const lines = await all<SoLineRow>(env, 'SELECT id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, delivered_qty, notes FROM sales_order_lines WHERE sales_order_id = ? ORDER BY line_no', id);
  return json({ data: { ...toSoHeaderPayload(header), lines: lines.map(toSoLinePayload) } });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change sales orders.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; subtotal_sen: number; tax_sen: number; total_sen: number; paid_sen: number }>(env, 'SELECT status, subtotal_sen, tax_sen, total_sen, paid_sen FROM sales_orders WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That sales order does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  // Record a payment.
  if (b.paySen !== undefined) {
    const payFields: Fields = {};
    checkSen(payFields, 'paySen', b.paySen, { label: 'Payment' });
    const badPay = invalid(payFields); if (badPay) return badPay;
    const pay = Math.max(0, intOrNull(b.paySen) ?? 0);
    if (pay <= 0) return fail('VALIDATION', 'Enter a payment amount.', 422);
    if (cur.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled order cannot take payment.', 409);
    const paid = Math.min(cur.total_sen, cur.paid_sen + pay);
    await run(env, 'UPDATE sales_orders SET paid_sen = ?, updated_at = ? WHERE id = ?', paid, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_order.payment', entityTable: 'sales_orders', entityId: id, after: { pay, paid } });
    return json({ id, paidSen: paid });
  }

  // Advance to the next status in the main flow.
  if (b.action === 'advance') {
    if (cur.status === 'ON_HOLD') return fail('CONFLICT', 'Resume the order before advancing it.', 409);
    const next = nextStatus(cur.status);
    if (!next) return fail('CONFLICT', 'This order cannot advance further.', 409);
    await run(env, 'UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?', next, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_order.advance', entityTable: 'sales_orders', entityId: id, after: { status: next } });
    return json({ id, status: next });
  }

  // Explicit status side transitions: hold / resume / cancel.
  if (b.status === 'ON_HOLD' || b.status === 'CANCELLED' || b.status === 'CONFIRMED') {
    if (b.status === 'CANCELLED' && (cur.status === 'DELIVERED' || cur.status === 'INVOICED' || cur.status === 'CLOSED')) return fail('CONFLICT', 'A delivered or invoiced order cannot be cancelled.', 409);
    if (b.status === 'CONFIRMED' && cur.status !== 'ON_HOLD') return fail('CONFLICT', 'Only a held order can be resumed.', 409);
    await run(env, `UPDATE sales_orders SET status = ?, ${b.status === 'CANCELLED' ? 'cancelled_at = ?,' : ''} updated_at = ? WHERE id = ?`,
      ...(b.status === 'CANCELLED' ? [b.status, now, now, id] : [b.status, now, id]));
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_order.status', entityTable: 'sales_orders', entityId: id, after: { status: b.status } });
    return json({ id });
  }
  if (b.status !== undefined) return fail('VALIDATION', 'Use action=advance for the production flow.', 422);

  // Edit (header + optional lines) — only while CONFIRMED.
  if (cur.status !== 'CONFIRMED') return fail('CONFLICT', 'Only a confirmed sales order can be edited.', 409);
  const fields: Fields = {};
  checkPhone(fields, 'customerPhone', b.customerPhone);
  checkDate(fields, 'soDate', b.soDate, { label: 'SO date' });
  checkDate(fields, 'targetDate', b.targetDate, { label: 'Target date' });
  checkSen(fields, 'taxSen', b.taxSen, { label: 'Tax' });
  checkSen(fields, 'depositSen', b.depositSen, { label: 'Deposit' });
  if (Array.isArray(b.lines)) (b.lines as Record<string, unknown>[]).forEach((l, i) => {
    checkInt(fields, `lines.${i}.qty`, l?.qty, { label: 'Quantity', min: 0 });
    checkSen(fields, `lines.${i}.unitPriceSen`, l?.unitPriceSen, { label: 'Unit price' });
    checkSen(fields, `lines.${i}.discountSen`, l?.discountSen, { label: 'Discount' });
  });
  const bad = invalid(fields); if (bad) return bad;
  const sets: string[] = [];
  const args: unknown[] = [];
  if (b.customerName !== undefined) { const n = String(b.customerName).trim(); if (!n) return fail('VALIDATION', 'Enter a customer name.', 422, { customerName: 'Enter a customer name.' }); sets.push('customer_name = ?'); args.push(n); }
  if (b.customerPhone !== undefined) { sets.push('customer_phone = ?'); args.push(strOrNull(b.customerPhone)); }
  if (b.customerPo !== undefined) { sets.push('customer_po = ?'); args.push(strOrNull(b.customerPo)); }
  if (b.soDate !== undefined) { sets.push('so_date = ?'); args.push(strOrNull(b.soDate) ?? mytToday()); }
  if (b.targetDate !== undefined) { sets.push('target_date = ?'); args.push(strOrNull(b.targetDate)); }
  if (b.depositSen !== undefined) { sets.push('deposit_sen = ?'); args.push(Math.max(0, intOrNull(b.depositSen) ?? 0)); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }

  let subtotal = cur.subtotal_sen;
  if (b.lines !== undefined) {
    const lines = normalizeLines(b.lines);
    if (!lines.length) return fail('VALIDATION', 'A sales order needs at least one line.', 422, { lines: 'Add at least one line.' });
    await run(env, 'DELETE FROM sales_order_lines WHERE sales_order_id = ?', id);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await run(env, `INSERT INTO sales_order_lines (id, sales_order_id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, delivered_qty, notes)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        genId('sol'), id, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.discountSen, l.lineTotalSen, l.notes);
    }
    subtotal = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  }
  const tax = b.taxSen !== undefined ? Math.max(0, intOrNull(b.taxSen) ?? 0) : cur.tax_sen;
  sets.push('subtotal_sen = ?', 'tax_sen = ?', 'total_sen = ?'); args.push(subtotal, tax, subtotal + tax);
  sets.push('updated_at = ?'); args.push(now);
  args.push(id);
  await run(env, `UPDATE sales_orders SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_order.update', entityTable: 'sales_orders', entityId: id, after: { total: subtotal + tax } });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete sales orders.', 403);
  const id = String(params.id);
  const c = await one<{ doc_no: string; status: string }>(env, 'SELECT doc_no, status FROM sales_orders WHERE id = ?', id);
  if (!c) return fail('NOT_FOUND', 'That sales order does not exist.', 404);
  if (c.status !== 'CONFIRMED') return fail('CONFLICT', 'Only a confirmed sales order can be deleted. Cancel it instead.', 409);
  await run(env, 'DELETE FROM sales_orders WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_order.delete', entityTable: 'sales_orders', entityId: id, before: { docNo: c.doc_no } });
  return new Response(null, { status: 204 });
};
