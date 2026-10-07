import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { recomputeSiStatus, toSiHeaderPayload, toSiLinePayload, type SiHeaderRow, type SiLineRow } from '../../_lib/sales-invoices';

const HEADER_SQL = `
  SELECT si.id, si.invoice_number, si.delivery_order_id, si.sales_order_id, si.customer_name, si.invoice_date, si.due_date,
         si.currency, si.subtotal_sen, si.tax_sen, si.total_sen, si.paid_sen, si.status, si.notes, si.created_at, si.updated_at,
         d.do_number, so.doc_no AS so_doc_no
  FROM sales_invoices si LEFT JOIN delivery_orders d ON d.id = si.delivery_order_id LEFT JOIN sales_orders so ON so.id = si.sales_order_id WHERE si.id = ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<SiHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That sales invoice does not exist.', 404);
  const lines = await all<SiLineRow>(env, 'SELECT id, line_no, item_code, description, uom, qty, unit_price_sen, line_total_sen FROM sales_invoice_lines WHERE sales_invoice_id = ? ORDER BY line_no', id);
  return json({ data: { ...toSiHeaderPayload(header), lines: lines.map(toSiLinePayload) } });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change sales invoices.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; total_sen: number; paid_sen: number; delivery_order_id: string | null }>(env, 'SELECT status, total_sen, paid_sen, delivery_order_id FROM sales_invoices WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That sales invoice does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  // Record a receipt.
  if (b.receiveSen !== undefined) {
    const amt = Math.max(0, Number(b.receiveSen) || 0);
    if (amt <= 0) return fail('VALIDATION', 'Enter a receipt amount.', 422);
    if (cur.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled invoice cannot take a receipt.', 409);
    const paid = Math.min(cur.total_sen, cur.paid_sen + Math.round(amt));
    await run(env, 'UPDATE sales_invoices SET paid_sen = ?, updated_at = ? WHERE id = ?', paid, now, id);
    await recomputeSiStatus(env, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_invoice.receipt', entityTable: 'sales_invoices', entityId: id, after: { paid } });
    return json({ id, paidSen: paid });
  }

  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id });
    if (cur.paid_sen > 0) return fail('CONFLICT', 'A part-paid invoice cannot be cancelled. Reverse the receipt first.', 409);
    await run(env, 'UPDATE sales_invoices SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
    // Un-invoice the delivery order so it can be re-billed.
    if (cur.delivery_order_id) await run(env, `UPDATE delivery_orders SET status = 'DELIVERED', updated_at = ? WHERE id = ? AND status = 'INVOICED'`, now, cur.delivery_order_id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_invoice.cancel', entityTable: 'sales_invoices', entityId: id });
    return json({ id });
  }

  return fail('VALIDATION', 'Only a receipt or CANCELLED is accepted.', 422);
};
