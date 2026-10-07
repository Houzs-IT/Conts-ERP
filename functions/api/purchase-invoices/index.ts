import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { nextInvoiceNumber, toPiHeaderPayload, type PiHeaderRow } from '../../_lib/purchase-invoices';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const LIST_SQL = `
  SELECT pi.id, pi.invoice_number, pi.supplier_invoice_ref, pi.supplier_id, pi.purchase_order_id, pi.grn_id, pi.invoice_date,
         pi.due_date, pi.currency, pi.subtotal_sen, pi.tax_sen, pi.total_sen, pi.paid_sen, pi.status, pi.notes,
         pi.created_at, pi.updated_at, s.code AS supplier_code, s.name AS supplier_name, g.grn_number, po.po_number
  FROM purchase_invoices pi
  JOIN suppliers s ON s.id = pi.supplier_id
  LEFT JOIN goods_receipts g ON g.id = pi.grn_id
  LEFT JOIN purchase_orders po ON po.id = pi.purchase_order_id`;

/** GET /api/purchase-invoices?status=&supplierId=&search= — headers, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplierId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (['POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'].includes(status ?? '')) { where.push('pi.status = ?'); args.push(status); }
  if (supplierId) { where.push('pi.supplier_id = ?'); args.push(supplierId); }
  if (search) { where.push('(lower(pi.invoice_number) LIKE ? OR lower(coalesce(pi.supplier_invoice_ref, \'\')) LIKE ? OR lower(s.name) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<PiHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY pi.invoice_date DESC, pi.invoice_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toPiHeaderPayload) });
};

/** POST /api/purchase-invoices { grnId?, supplierId?, supplierInvoiceRef?, invoiceDate?, dueDate?, notes?, taxSen?, lines[] } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can post purchase invoices.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const grnId = strOrNull(b.grnId);
  let supplierId = String(b.supplierId ?? '').trim();
  let poId: string | null = null;

  if (grnId) {
    const grn = await one<{ supplier_id: string; purchase_order_id: string; status: string }>(env, 'SELECT supplier_id, purchase_order_id, status FROM goods_receipts WHERE id = ?', grnId);
    if (!grn) return fail('VALIDATION', 'That goods receipt does not exist.', 422, { grnId: 'Unknown goods receipt.' });
    if (grn.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled goods receipt cannot be invoiced.', 409);
    supplierId = grn.supplier_id;
    poId = grn.purchase_order_id;
  }
  if (!supplierId) return fail('VALIDATION', 'Pick a supplier or a goods receipt.', 422, { supplierId: 'Pick a supplier.' });
  if (!await one(env, 'SELECT 1 AS x FROM suppliers WHERE id = ?', supplierId)) return fail('VALIDATION', 'Unknown supplier.', 422, { supplierId: 'Unknown supplier.' });

  const raw = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const lines = raw.map(l => {
    const qty = Math.max(0, intOrNull(l.qty) ?? 0);
    const unitPriceSen = Math.max(0, intOrNull(l.unitPriceSen) ?? 0);
    return { grnLineId: strOrNull(l.grnLineId), itemCode: String(l.itemCode ?? '').trim(), description: String(l.description ?? '').trim(), uom: String(l.uom ?? 'UNIT').trim() || 'UNIT', qty, unitPriceSen, lineTotalSen: qty * unitPriceSen };
  }).filter(l => l.itemCode && l.description && l.qty > 0);
  if (!lines.length) return fail('VALIDATION', 'Add at least one line with a quantity.', 422, { lines: 'Add at least one line.' });

  const subtotal = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  const tax = Math.max(0, intOrNull(b.taxSen) ?? 0);
  const total = subtotal + tax;
  const id = genId('pinv');
  const invoiceNumber = await nextInvoiceNumber(env);
  const now = nowIso();
  const invoiceDate = strOrNull(b.invoiceDate) ?? now.slice(0, 10);

  await run(env, `
    INSERT INTO purchase_invoices (id, invoice_number, supplier_invoice_ref, supplier_id, purchase_order_id, grn_id, invoice_date,
      due_date, currency, subtotal_sen, tax_sen, total_sen, paid_sen, status, notes, posted_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MYR', ?, ?, ?, 0, 'POSTED', ?, ?, ?, ?, ?)`,
    id, invoiceNumber, strOrNull(b.supplierInvoiceRef), supplierId, poId, grnId, invoiceDate, strOrNull(b.dueDate),
    subtotal, tax, total, strOrNull(b.notes), now, session.userId, now, now);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `INSERT INTO purchase_invoice_lines (id, purchase_invoice_id, grn_line_id, line_no, item_code, description, uom, qty, unit_price_sen, line_total_sen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      genId('pil'), id, l.grnLineId, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.lineTotalSen);
    if (l.grnLineId) await run(env, 'UPDATE goods_receipt_lines SET invoiced_qty = invoiced_qty + ? WHERE id = ?', l.qty, l.grnLineId);
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_invoice.create', entityTable: 'purchase_invoices', entityId: id, after: { invoiceNumber, supplierId, total } });
  return json({ id, invoiceNumber }, 201);
};
