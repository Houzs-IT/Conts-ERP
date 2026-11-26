import { type Env, fail } from '../../../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../../../_lib/auth';
import { forwardClaims } from '../../../../../../_lib/claimsForward';
import { knownInvoice } from '../../../../../../_lib/cleaningBilling';

/** GET /api/housekeeping/cleaning-invoices/:id/payments/:paymentId/slip — the client's transfer slip, as the engine keeps it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Client payments are seen by the office.', 403);
  const id = String(params.id);
  if (!(await knownInvoice(env, id))) return fail('NOT_FOUND', 'No cleaning job is billed on that invoice.', 404);
  return forwardClaims(env, session, 'GET', `/cleaning-invoices/${encodeURIComponent(id)}/payments/${encodeURIComponent(String(params.paymentId))}/slip`);
};
