import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { toPiHeaderPayload, toPiLinePayload, type PiHeaderRow, type PiLineRow } from '../../_lib/purchase-invoices';

const HEADER_SQL = `
  SELECT pi.id, pi.invoice_number, pi.supplier_invoice_ref, pi.supplier_id, pi.purchase_order_id, pi.grn_id, pi.invoice_date,
         pi.due_date, pi.currency, pi.subtotal_sen, pi.tax_sen, pi.total_sen, pi.paid_sen, pi.status, pi.notes,
         pi.created_at, pi.updated_at, s.code AS supplier_code, s.name AS supplier_name, g.grn_number, po.po_number
  FROM purchase_invoices pi
  JOIN suppliers s ON s.id = pi.supplier_id
  LEFT JOIN goods_receipts g ON g.id = pi.grn_id
  LEFT JOIN purchase_orders po ON po.id = pi.purchase_order_id WHERE pi.id = ?`;

/** GET /api/purchase-invoices/:id — header + lines. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<PiHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That purchase invoice does not exist.', 404);
  const lines = await all<PiLineRow>(env, 'SELECT id, grn_line_id, line_no, item_code, description, uom, qty, unit_price_sen, line_total_sen FROM purchase_invoice_lines WHERE purchase_invoice_id = ? ORDER BY line_no', id);
  return json({ data: { ...toPiHeaderPayload(header), lines: lines.map(toPiLinePayload) } });
};

/** PATCH /api/purchase-invoices/:id — cancel (reverses the GRN invoiced_qty). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change purchase invoices.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string; paid_sen: number }>(env, 'SELECT status, paid_sen FROM purchase_invoices WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That purchase invoice does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  if (b.status !== 'CANCELLED') return fail('VALIDATION', 'Only CANCELLED is accepted here; payments post via payment vouchers.', 422);
  if (cur.status === 'CANCELLED') return json({ id });
  if (cur.paid_sen > 0) return fail('CONFLICT', 'A paid or part-paid invoice cannot be cancelled. Reverse the payment first.', 409);

  const lines = await all<{ grn_line_id: string | null; qty: number }>(env, 'SELECT grn_line_id, qty FROM purchase_invoice_lines WHERE purchase_invoice_id = ?', id);
  for (const l of lines) {
    if (l.grn_line_id) await run(env, 'UPDATE goods_receipt_lines SET invoiced_qty = GREATEST(0, invoiced_qty - ?) WHERE id = ?', l.qty, l.grn_line_id);
  }
  await run(env, 'UPDATE purchase_invoices SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_invoice.cancel', entityTable: 'purchase_invoices', entityId: id });
  return json({ id });
};
