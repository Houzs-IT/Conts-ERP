import { type Env, all, one, run, json, fail, nowIso, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { nextSiNumber, toSiHeaderPayload, type SiHeaderRow } from '../../_lib/sales-invoices';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkSen, checkDate, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT si.id, si.invoice_number, si.delivery_order_id, si.sales_order_id, si.customer_name, si.invoice_date, si.due_date,
         si.currency, si.subtotal_sen, si.tax_sen, si.total_sen, si.paid_sen, si.status, si.notes, si.created_at, si.updated_at,
         d.do_number, so.doc_no AS so_doc_no
  FROM sales_invoices si LEFT JOIN delivery_orders d ON d.id = si.delivery_order_id LEFT JOIN sales_orders so ON so.id = si.sales_order_id`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].includes(status ?? '')) { where.push('si.status = ?'); args.push(status); }
  if (search) { where.push('(lower(si.invoice_number) LIKE ? OR lower(si.customer_name) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q); }

  const rows = await all<SiHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY si.invoice_date DESC, si.invoice_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toSiHeaderPayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise sales invoices.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkDate(fields, 'invoiceDate', b.invoiceDate, { label: 'Invoice date' });
  checkDate(fields, 'dueDate', b.dueDate, { label: 'Due date', min: typeof b.invoiceDate === 'string' ? b.invoiceDate : undefined });
  checkSen(fields, 'taxSen', b.taxSen, { label: 'Tax' });
  const bad = invalid(fields); if (bad) return bad;
  const doId = String(b.deliveryOrderId ?? '').trim();
  const dord = await one<{ id: string; customer_name: string; sales_order_id: string | null; status: string }>(env, 'SELECT id, customer_name, sales_order_id, status FROM delivery_orders WHERE id = ?', doId);
  if (!dord) return fail('VALIDATION', 'Pick a delivery order.', 422, { deliveryOrderId: 'Unknown delivery order.' });
  if (dord.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled delivery order cannot be invoiced.', 409);
  if (dord.status === 'INVOICED') return fail('CONFLICT', 'That delivery order is already invoiced.', 409);

  const doLines = await all<{ item_code: string; description: string; uom: string; qty: number; unit_price_sen: number; line_total_sen: number }>(env, 'SELECT item_code, description, uom, qty, unit_price_sen, line_total_sen FROM delivery_order_lines WHERE delivery_order_id = ? ORDER BY line_no', doId);
  if (!doLines.length) return fail('CONFLICT', 'That delivery order has no lines to invoice.', 409);

  const subtotal = doLines.reduce((s, l) => s + l.line_total_sen, 0);
  const tax = Math.max(0, intOrNull(b.taxSen) ?? 0);
  const total = subtotal + tax;
  const id = genId('sinv');
  const invoiceNumber = await nextSiNumber(env);
  const now = nowIso();

  await run(env, `INSERT INTO sales_invoices (id, invoice_number, delivery_order_id, sales_order_id, customer_name, invoice_date, due_date, currency, subtotal_sen, tax_sen, total_sen, paid_sen, status, notes, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'MYR', ?, ?, ?, 0, 'SENT', ?, ?, ?, ?)`,
    id, invoiceNumber, doId, dord.sales_order_id, dord.customer_name, strOrNull(b.invoiceDate) ?? mytToday(), strOrNull(b.dueDate), subtotal, tax, total, strOrNull(b.notes), session.userId, now, now);
  for (let i = 0; i < doLines.length; i++) {
    const l = doLines[i];
    await run(env, `INSERT INTO sales_invoice_lines (id, sales_invoice_id, line_no, item_code, description, uom, qty, unit_price_sen, line_total_sen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      genId('sil'), id, i + 1, l.item_code, l.description, l.uom, l.qty, l.unit_price_sen, l.line_total_sen);
  }
  await run(env, 'UPDATE delivery_orders SET status = ?, updated_at = ? WHERE id = ?', 'INVOICED', now, doId);
  if (dord.sales_order_id) await run(env, `UPDATE sales_orders SET status = 'INVOICED', updated_at = ? WHERE id = ? AND status IN ('DELIVERED','READY_TO_SHIP','SHIPPED')`, now, dord.sales_order_id);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_invoice.create', entityTable: 'sales_invoices', entityId: id, after: { invoiceNumber, doId, total } });
  return json({ id, invoiceNumber }, 201);
};
