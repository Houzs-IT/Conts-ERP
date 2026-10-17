import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { hasJobInvoices } from '../../../_lib/jobProfit';
import { isDayStr } from '../../../_lib/servicePrices';

/** POST /api/operations/job-invoices { kind: 'maintenance' | 'cleaning', jobId, supplierName, invoiceNo, invoiceDate, amount, documentId }
 *  A supplier's, contractor's or cleaner's invoice against a job: the job's actual cost (several are allowed; they add
 *  up). Stored as an expense on the job's unit paid by The Conts, with the invoice file as its receipt, so it is in the
 *  unit's costs and The Conts' side of the unit P&L and never on an owner statement. The file is required. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'The office submits invoices.', 403);
  if (!(await hasJobInvoices(env))) return fail('NOT_CONFIGURED', 'Job invoices need a database update (migration 0127) that is not applied yet.', 501);
  const b = await request.json<any>().catch(() => null);
  if (b?.kind !== 'maintenance' && b?.kind !== 'cleaning') return fail('VALIDATION', 'Say which kind of job.', 422);
  const fields: Record<string, string> = {};
  if (typeof b.supplierName !== 'string' || !b.supplierName.trim()) fields.supplierName = 'Enter the supplier, contractor or cleaner.';
  if (typeof b.invoiceNo !== 'string' || !b.invoiceNo.trim()) fields.invoiceNo = 'Enter the invoice number.';
  if (!isDayStr(b.invoiceDate)) fields.invoiceDate = 'Pick the invoice date.';
  if (!Number.isInteger(b.amount) || b.amount <= 0) fields.amount = 'Enter the amount, more than RM 0.00.';
  if (typeof b.documentId !== 'string' || !b.documentId) fields.file = 'Upload the invoice.';
  if (Object.keys(fields).length) return fail('VALIDATION', Object.values(fields)[0], 422, fields);

  const job = b.kind === 'maintenance'
    ? await one<{ id: string; unit_id: string | null; title: string }>(env, 'SELECT id, unit_id, title FROM maintenance_issues WHERE id = ?', String(b.jobId ?? ''))
    : await one<{ id: string; unit_id: string | null; title: string }>(env, 'SELECT id, unit_id, title FROM tasks WHERE id = ?', String(b.jobId ?? ''));
  if (!job) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  // An expense belongs to a unit: an external clean (an outside address) is costed by its cleaner's pay only.
  if (!job.unit_id) return fail('VALIDATION', 'An external cleaning job has no unit to put the invoice on. Its cost is the cleaner\'s pay.', 422);
  if (!(await one(env, 'SELECT 1 AS x FROM documents WHERE id = ?', b.documentId))) return fail('NOT_FOUND', 'Upload the invoice again.', 404, { file: 'Upload the invoice again.' });
  const id = crypto.randomUUID();
  const supplier = b.supplierName.trim().slice(0, 120), no = b.invoiceNo.trim().slice(0, 60);
  await run(env, `INSERT INTO expenses (id, unit_id, ${b.kind === 'maintenance' ? 'invoice_maintenance_id' : 'invoice_task_id'}, category, description, amount, currency,
      incurred_on, reference, charge_to, receipt_document_id, supplier_name, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'MYR', ?, ?, 'the_conts', ?, ?, ?, ?)`,
    id, job.unit_id, job.id, b.kind === 'maintenance' ? 'maintenance' : 'cleaning', `${supplier} invoice ${no} · ${job.title}`.slice(0, 300), b.amount,
    b.invoiceDate, no, b.documentId, supplier, session.userId, nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'job.invoice', entityTable: b.kind === 'maintenance' ? 'maintenance_issues' : 'tasks', entityId: job.id,
    after: { expenseId: id, supplier, invoiceNo: no, invoiceDate: b.invoiceDate, amount: b.amount, documentId: b.documentId } });
  return json({ id }, 201);
};
