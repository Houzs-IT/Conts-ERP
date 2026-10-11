import { type Env, all, one, run, json, fail, nowIso, audit, mytToday, isNumberClash } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isSoStatus, normalizeLines, computeTotals, toSoHeaderPayload, type SoHeaderRow } from '../../_lib/sales-orders';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkSen, checkInt, checkDate, checkPhone, invalid, type Fields } from '../../_lib/validate';

const today = () => mytToday();
const COLS = `id, doc_no, customer_name, customer_phone, customer_po, so_date, target_date, status, currency,
              subtotal_sen, tax_sen, total_sen, deposit_sen, paid_sen, notes, created_at, updated_at`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isSoStatus(status)) { where.push('status = ?'); args.push(status); }
  if (search) { where.push('(lower(doc_no) LIKE ? OR lower(customer_name) LIKE ? OR lower(coalesce(customer_po, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<SoHeaderRow>(env, `SELECT ${COLS} FROM sales_orders WHERE ${where.join(' AND ')} ORDER BY so_date DESC, doc_no DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toSoHeaderPayload) });
};

async function nextDocNo(env: Env): Promise<string> {
  const year = today().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(doc_no) AS mx FROM sales_orders WHERE doc_no LIKE ?', `SO-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `SO-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise sales orders.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const customerName = String(b.customerName ?? '').trim();
  if (!customerName) return fail('VALIDATION', 'Enter a customer name.', 422, { customerName: 'Enter a customer name.' });
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
  const lines = normalizeLines(b.lines);
  if (!lines.length) return fail('VALIDATION', 'Add at least one line.', 422, { lines: 'Add at least one line.' });

  const totals = computeTotals(lines, intOrNull(b.taxSen) ?? 0);
  const id = genId('so');
  let docNo = '';
  const now = nowIso();
  // The number is the highest so far plus one, so two made at once can pick the same one: the second header insert
  // then hits the unique number before anything is written, and simply takes the next number (isNumberClash).
  for (let attempt = 1; ; attempt++) {
    docNo = await nextDocNo(env);
    try {
      await run(env, `INSERT INTO sales_orders (id, doc_no, customer_name, customer_phone, customer_po, so_date, target_date, status, currency, subtotal_sen, tax_sen, total_sen, deposit_sen, paid_sen, notes, created_by, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        id, docNo, customerName, strOrNull(b.customerPhone), strOrNull(b.customerPo), strOrNull(b.soDate) ?? today(), strOrNull(b.targetDate),
        strOrNull(b.currency) ?? 'MYR', totals.subtotalSen, totals.taxSen, totals.totalSen, Math.max(0, intOrNull(b.depositSen) ?? 0), strOrNull(b.notes), session.userId, now, now);
      break;
    } catch (e) { if (attempt >= 5 || !isNumberClash(e)) throw e; }
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `INSERT INTO sales_order_lines (id, sales_order_id, line_no, item_code, description, uom, qty, unit_price_sen, discount_sen, line_total_sen, delivered_qty, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      genId('sol'), id, i + 1, l.itemCode, l.description, l.uom, l.qty, l.unitPriceSen, l.discountSen, l.lineTotalSen, l.notes);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'sales_order.create', entityTable: 'sales_orders', entityId: id, after: { docNo, customerName, total: totals.totalSen } });
  return json({ id, docNo }, 201);
};
