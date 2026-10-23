import { type Env, one, run, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { can } from '../../../_lib/access';
import { hasJobInvoices } from '../../../_lib/jobProfit';

/** DELETE /api/operations/job-invoices/:id — takes back an invoice entered against the wrong job or twice. Only an invoice
 *  (an expense with an invoice link), and only by the roles that see job costs. Its file stays in documents; the removal is
 *  audit-logged with everything it held. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && !can(session, 'finance', 'view')) return fail('FORBIDDEN', 'Only managers and finance take back an invoice.', 403);
  if (!(await hasJobInvoices(env))) return fail('NOT_CONFIGURED', 'Job invoices need a database update (migration 0127) that is not applied yet.', 501);
  const e = await one<any>(env, `SELECT * FROM expenses WHERE id = ? AND (invoice_maintenance_id IS NOT NULL OR invoice_task_id IS NOT NULL)`, String(params.id));
  if (!e) return fail('NOT_FOUND', 'That invoice no longer exists.', 404);
  await run(env, 'DELETE FROM expenses WHERE id = ?', e.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'job.invoice_delete', entityTable: 'expenses', entityId: e.id,
    before: { maintenanceId: e.invoice_maintenance_id, taskId: e.invoice_task_id, supplier: e.supplier_name, invoiceNo: e.reference, invoiceDate: e.incurred_on, amount: Number(e.amount), documentId: e.receipt_document_id } });
  return json({ ok: true });
};
