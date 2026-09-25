import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/** GET /api/accounting — AP (what we owe suppliers, from purchase invoices) and AR (what
 *  customers owe us, from sales invoices), each summarised by party with outstanding + count.
 *  POSTED credit/debit notes adjust the party's balance (credit notes down, debit notes up) —
 *  Conts's stand-in for the journal Houzs posts. A party can go into credit (negative).
 *  Read-only; finance-gated. Ties the buy-side and sell-side ledgers together. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return json({ generatedAt: nowIso(), payables: [], receivables: [], apTotalSen: 0, arTotalSen: 0, restricted: true });

  const today = nowIso().slice(0, 10);
  const payables = await all<{ code: string; name: string; outstanding: number; invoices: number; overdue: number }>(env, `
    WITH inv AS (
      SELECT supplier_id, SUM(total_sen - paid_sen) AS owed,
             SUM(CASE WHEN total_sen > paid_sen THEN 1 ELSE 0 END) AS invoices,
             SUM(CASE WHEN total_sen > paid_sen AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
      FROM purchase_invoices WHERE status <> 'CANCELLED' GROUP BY supplier_id),
    nt AS (SELECT supplier_id, -SUM(total_sen) AS adj FROM credit_notes WHERE kind = 'SCN' AND status = 'POSTED' GROUP BY supplier_id)
    SELECT s.code, s.name, COALESCE(inv.owed, 0) + COALESCE(nt.adj, 0) AS outstanding,
           COALESCE(inv.invoices, 0) AS invoices, COALESCE(inv.overdue, 0) AS overdue
    FROM inv FULL OUTER JOIN nt ON nt.supplier_id = inv.supplier_id
    JOIN suppliers s ON s.id = COALESCE(inv.supplier_id, nt.supplier_id)
    WHERE COALESCE(inv.owed, 0) + COALESCE(nt.adj, 0) <> 0
    ORDER BY outstanding DESC`, today);

  const receivables = await all<{ customer_name: string; outstanding: number; invoices: number; overdue: number }>(env, `
    WITH inv AS (
      SELECT customer_name, SUM(total_sen - paid_sen) AS owed,
             SUM(CASE WHEN total_sen > paid_sen THEN 1 ELSE 0 END) AS invoices,
             SUM(CASE WHEN total_sen > paid_sen AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
      FROM sales_invoices WHERE status <> 'CANCELLED' GROUP BY customer_name),
    nt AS (SELECT party_name, SUM(CASE kind WHEN 'DN' THEN total_sen ELSE -total_sen END) AS adj
           FROM credit_notes WHERE party_type = 'CUSTOMER' AND status = 'POSTED' GROUP BY party_name)
    SELECT COALESCE(inv.customer_name, nt.party_name) AS customer_name, COALESCE(inv.owed, 0) + COALESCE(nt.adj, 0) AS outstanding,
           COALESCE(inv.invoices, 0) AS invoices, COALESCE(inv.overdue, 0) AS overdue
    FROM inv FULL OUTER JOIN nt ON nt.party_name = inv.customer_name
    WHERE COALESCE(inv.owed, 0) + COALESCE(nt.adj, 0) <> 0
    ORDER BY outstanding DESC`, today);

  const apTotalSen = payables.reduce((s, r) => s + r.outstanding, 0);
  const arTotalSen = receivables.reduce((s, r) => s + r.outstanding, 0);
  return json({
    generatedAt: nowIso(),
    payables: payables.map(r => ({ code: r.code, name: r.name, outstandingSen: r.outstanding, invoices: r.invoices, overdue: r.overdue })),
    receivables: receivables.map(r => ({ name: r.customer_name, outstandingSen: r.outstanding, invoices: r.invoices, overdue: r.overdue })),
    apTotalSen, arTotalSen,
  });
};
