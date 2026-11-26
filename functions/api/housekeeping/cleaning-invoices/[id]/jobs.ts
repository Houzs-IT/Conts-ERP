import { type Env, json, fail, audit } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { knownInvoice, outsideJobsByIds, reviseInvoice } from '../../../../_lib/cleaningBilling';

/** POST /api/housekeeping/cleaning-invoices/:id/jobs { taskId }
 *  An outside job added to an invoice already made (Add cleaning job: "Add to this month's invoice"; chew, 27 Nov 2026),
 *  paid or not: a line of its own at its amount, or, on a lump sum, its day under the same total. The books follow. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaning invoices are made by the office.', 403);
  const id = String(params.id);
  const known = await knownInvoice(env, id);
  if (!known) return fail('NOT_FOUND', 'No cleaning job is billed on that invoice.', 404);
  const b = await request.json<{ taskId?: unknown }>().catch(() => null);
  const [job] = await outsideJobsByIds(env, [String(b?.taskId ?? '')]);
  if (!job) return fail('NOT_FOUND', 'That is not an outside cleaning job.', 404);
  if (job.invoiceId) return fail('CONFLICT', `This job is already billed on ${job.invoiceNo}.`, 409);
  const refused = await reviseInvoice(env, session, id, { add: job });
  if (refused) return refused;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.invoice_add', entityTable: 'tasks', entityId: job.id, after: { invoiceNo: known.invoiceNo } });
  return json({ invoiceNo: known.invoiceNo });
};
