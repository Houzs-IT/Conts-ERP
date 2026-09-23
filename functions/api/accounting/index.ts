import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/** GET /api/accounting — AP (what we owe suppliers, from purchase invoices) and AR (what
 *  customers owe us, from sales invoices), each summarised by party with outstanding + count.
 *  Read-only; finance-gated. Ties the buy-side and sell-side ledgers together. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return json({ generatedAt: nowIso(), payables: [], receivables: [], apTotalSen: 0, arTotalSen: 0, restricted: true });

  const payables = await all<{ code: string; name: string; outstanding: number; invoices: number; overdue: number }>(env, `
    SELECT s.code, s.name, SUM(pi.total_sen - pi.paid_sen) AS outstanding, COUNT(*) AS invoices,
           SUM(CASE WHEN pi.due_date IS NOT NULL AND pi.due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
    WHERE pi.status <> 'CANCELLED' AND pi.total_sen > pi.paid_sen
    GROUP BY s.code, s.name ORDER BY outstanding DESC`, nowIso().slice(0, 10));

  const receivables = await all<{ customer_name: string; outstanding: number; invoices: number; overdue: number }>(env, `
    SELECT customer_name, SUM(total_sen - paid_sen) AS outstanding, COUNT(*) AS invoices,
           SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM sales_invoices
    WHERE status <> 'CANCELLED' AND total_sen > paid_sen
    GROUP BY customer_name ORDER BY outstanding DESC`, nowIso().slice(0, 10));

  const apTotalSen = payables.reduce((s, r) => s + r.outstanding, 0);
  const arTotalSen = receivables.reduce((s, r) => s + r.outstanding, 0);
  return json({
    generatedAt: nowIso(),
    payables: payables.map(r => ({ code: r.code, name: r.name, outstandingSen: r.outstanding, invoices: r.invoices, overdue: r.overdue })),
    receivables: receivables.map(r => ({ name: r.customer_name, outstandingSen: r.outstanding, invoices: r.invoices, overdue: r.overdue })),
    apTotalSen, arTotalSen,
  });
};
