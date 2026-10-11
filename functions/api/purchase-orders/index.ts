import { type Env, all, one, run, json, fail, nowIso, audit, mytToday, isNumberClash } from '../../_lib/db';
import { refuseUnknownItemCodes } from '../../_lib/products';
import { requireSession } from '../../_lib/auth';
import { isPoStatus, normalizeLines, computeTotals, toPoHeaderPayload, checkPricedBody, type PoHeaderRow } from '../../_lib/purchase-orders';
import { invalid, type Fields } from '../../_lib/validate';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const today = () => mytToday();

const LIST_SQL = `
  SELECT po.id, po.po_number, po.supplier_id, po.status, po.po_date, po.expected_at, po.warehouse_id, po.currency,
         po.subtotal_sen, po.tax_sen, po.total_sen, po.notes, po.submitted_at, po.received_at, po.cancelled_at,
         po.created_at, po.updated_at, s.code AS supplier_code, s.name AS supplier_name
  FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id`;

/** GET /api/purchase-orders?status=&supplierId=&search= — headers only, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplierId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isPoStatus(status)) { where.push('po.status = ?'); args.push(status); }
  if (supplierId) { where.push('po.supplier_id = ?'); args.push(supplierId); }
  if (search) { where.push('(lower(po.po_number) LIKE ? OR lower(s.name) LIKE ? OR lower(s.code) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<PoHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY po.po_date DESC, po.po_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toPoHeaderPayload) });
};

/** Next PO number: PO-<year>-<seq4>, sequential within the year. */
async function nextPoNumber(env: Env): Promise<string> {
  const year = today().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, `SELECT MAX(po_number) AS mx FROM purchase_orders WHERE po_number LIKE ?`, `PO-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `PO-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

/** POST /api/purchase-orders { supplierId, poDate?, expectedAt?, warehouseId?, currency?, notes?, taxSen?, lines[] } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise purchase orders.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkPricedBody(fields, b, 'poDate', 'PO date');
  const bad = invalid(fields); if (bad) return bad;
  const supplierId = String(b.supplierId ?? '').trim();
  if (!supplierId) return fail('VALIDATION', 'Pick a supplier.', 422, { supplierId: 'Pick a supplier.' });
  if (!await one(env, 'SELECT 1 AS x FROM suppliers WHERE id = ?', supplierId)) return fail('VALIDATION', 'That supplier does not exist.', 422, { supplierId: 'Unknown supplier.' });

  const lines = normalizeLines(b.lines);
  if (!lines.length) return fail('VALIDATION', 'Add at least one line with an item code and description.', 422, { lines: 'Add at least one line.' });
  { const unknownCodes = await refuseUnknownItemCodes(env, lines.map(l => l.itemCode)); if (unknownCodes) return unknownCodes; } // every item code must be in Products

  const totals = computeTotals(lines, intOrNull(b.taxSen) ?? 0);
  const id = genId('po');
  let poNumber = '';
  const now = nowIso();
  const poDate = strOrNull(b.poDate) ?? today();

  // The number is the highest so far plus one, so two made at once can pick the same one: the second header insert
  // then hits the unique number before anything is written, and simply takes the next number (isNumberClash).
  for (let attempt = 1; ; attempt++) {
    poNumber = await nextPoNumber(env);
    try {
      await run(env, `
        INSERT INTO purchase_orders (id, po_number, supplier_id, status, po_date, expected_at, warehouse_id, currency,
          subtotal_sen, tax_sen, total_sen, notes, submitted_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, poNumber, supplierId, poDate, strOrNull(b.expectedAt), strOrNull(b.warehouseId), strOrNull(b.currency) ?? 'MYR',
        totals.subtotalSen, totals.taxSen, totals.totalSen, strOrNull(b.notes), now, session.userId, now, now);
      break;
    } catch (e) { if (attempt >= 5 || !isNumberClash(e)) throw e; }
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `
      INSERT INTO purchase_order_lines (id, purchase_order_id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, received_qty, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      genId('pol'), id, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.discountSen, l.lineTotalSen, l.notes);
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'purchase_order.create', entityTable: 'purchase_orders', entityId: id, after: { poNumber, supplierId, total: totals.totalSen } });
  return json({ id, poNumber }, 201);
};
