import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/unbilled-deliveries?search= — delivery orders that have been dispatched but not
 *  yet billed (no active sales invoice, and not cancelled/invoiced). Read-only AR report,
 *  ported from 2990's SCM UnbilledDeliveries. Total is the sum of the DO's line values (sen). */
interface Row { id: string; do_number: string; customer_name: string; do_date: string; status: string; so_doc_no: string | null; total_sen: number; line_count: number }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = [
    "d.status NOT IN ('CANCELLED','INVOICED')",
    "NOT EXISTS (SELECT 1 FROM sales_invoices si WHERE si.delivery_order_id = d.id AND si.status <> 'CANCELLED')",
  ];
  const args: unknown[] = [];
  if (search) { where.push('(lower(d.do_number) LIKE ? OR lower(d.customer_name) LIKE ? OR lower(coalesce(so.doc_no, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<Row>(env, `
    SELECT d.id, d.do_number, d.customer_name, d.do_date, d.status, so.doc_no AS so_doc_no,
           COALESCE((SELECT SUM(line_total_sen) FROM delivery_order_lines WHERE delivery_order_id = d.id), 0) AS total_sen,
           (SELECT COUNT(*) FROM delivery_order_lines WHERE delivery_order_id = d.id) AS line_count
    FROM delivery_orders d
    LEFT JOIN sales_orders so ON so.id = d.sales_order_id
    WHERE ${where.join(' AND ')}
    ORDER BY d.do_date ASC, d.do_number ASC`, ...args);

  const data = rows.map(r => ({
    id: r.id, doNumber: r.do_number, customerName: r.customer_name, doDate: r.do_date, status: r.status,
    soDocNo: r.so_doc_no ?? '', totalSen: r.total_sen, lineCount: r.line_count,
  }));
  const totalSen = data.reduce((s, r) => s + r.totalSen, 0);
  return json({ generatedAt: nowIso(), data, totalSen });
};
