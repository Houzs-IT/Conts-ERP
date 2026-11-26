import { type Env, json, fail, audit } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { knownInvoice, reviseInvoice } from '../../../../_lib/cleaningBilling';

/** POST /api/housekeeping/cleaning-invoices/:id/total { totalSen }
 *  A lump-sum invoice's total changed (a package re-priced). Never below what the client has paid; the books follow. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaning invoices are changed by the office.', 403);
  const id = String(params.id);
  const known = await knownInvoice(env, id);
  if (!known) return fail('NOT_FOUND', 'No cleaning job is billed on that invoice.', 404);
  const b = await request.json<{ totalSen?: unknown }>().catch(() => null);
  const total = Number(b?.totalSen);
  if (!Number.isSafeInteger(total) || total <= 0) return fail('VALIDATION', 'Enter the new total.', 422, { totalSen: 'Enter the new total.' });
  const refused = await reviseInvoice(env, session, id, { totalSen: total });
  if (refused) return refused;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.invoice_total', entityTable: 'tasks', entityId: id, after: { invoiceNo: known.invoiceNo, totalSen: total } });
  return json({ invoiceNo: known.invoiceNo, totalSen: total });
};
