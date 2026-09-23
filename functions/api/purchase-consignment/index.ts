import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { isPcStatus, normalizeLines, computeTotals, toPcHeaderPayload, type PcHeaderRow } from '../../_lib/purchase-consignment';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const today = () => nowIso().slice(0, 10);
const LIST_SQL = `
  SELECT pc.id, pc.pc_number, pc.supplier_id, pc.status, pc.pc_date, pc.expected_at, pc.warehouse_id, pc.currency,
         pc.subtotal_sen, pc.tax_sen, pc.total_sen, pc.notes, pc.submitted_at, pc.cancelled_at, pc.created_at, pc.updated_at,
         s.code AS supplier_code, s.name AS supplier_name
  FROM pc_orders pc JOIN suppliers s ON s.id = pc.supplier_id`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplierId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isPcStatus(status)) { where.push('pc.status = ?'); args.push(status); }
  if (supplierId) { where.push('pc.supplier_id = ?'); args.push(supplierId); }
  if (search) { where.push('(lower(pc.pc_number) LIKE ? OR lower(s.name) LIKE ? OR lower(s.code) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<PcHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY pc.pc_date DESC, pc.pc_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toPcHeaderPayload) });
};

async function nextPcNumber(env: Env): Promise<string> {
  const year = today().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(pc_number) AS mx FROM pc_orders WHERE pc_number LIKE ?', `PC-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `PC-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise consignment orders.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const supplierId = String(b.supplierId ?? '').trim();
  if (!supplierId || !await one(env, 'SELECT 1 AS x FROM suppliers WHERE id = ?', supplierId)) return fail('VALIDATION', 'Pick a supplier.', 422, { supplierId: 'Unknown supplier.' });
  const lines = normalizeLines(b.lines);
  if (!lines.length) return fail('VALIDATION', 'Add at least one line.', 422, { lines: 'Add at least one line.' });

  const totals = computeTotals(lines, intOrNull(b.taxSen) ?? 0);
  const id = genId('pc');
  const pcNumber = await nextPcNumber(env);
  const now = nowIso();
  await run(env, `INSERT INTO pc_orders (id, pc_number, supplier_id, status, pc_date, expected_at, warehouse_id, currency, subtotal_sen, tax_sen, total_sen, notes, submitted_at, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, pcNumber, supplierId, strOrNull(b.pcDate) ?? today(), strOrNull(b.expectedAt), strOrNull(b.warehouseId), strOrNull(b.currency) ?? 'MYR',
    totals.subtotalSen, totals.taxSen, totals.totalSen, strOrNull(b.notes), now, session.userId, now, now);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `INSERT INTO pc_order_lines (id, pc_order_id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, received_qty, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      genId('pcl'), id, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.discountSen, l.lineTotalSen, l.notes);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'pc_order.create', entityTable: 'pc_orders', entityId: id, after: { pcNumber, supplierId, total: totals.totalSen } });
  return json({ id, pcNumber }, 201);
};
