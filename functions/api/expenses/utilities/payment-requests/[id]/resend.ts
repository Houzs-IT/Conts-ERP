import { type Env, fail, json, audit } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { forwardClaims } from '../../../../../_lib/claimsForward';
import { billsOnRequest, requestState, RETURNED, unlinkRequest } from '../../../../../_lib/utilityRequests';

/** POST /api/expenses/utilities/payment-requests/:id/resend
 *  "Send again" on Utility bills: a utility payment request that finance rejected, or that was withdrawn, goes back to
 *  finance with its bills as they are now (chew, 13 Nov 2026: change it and send it again; SOP 3.10). The same request
 *  and number (engine conts/utility-bill-routes.ts resubmitUtilityRequestHandler), a line per bill the company still
 *  pays; a bill the owner now pays is let go of the request once it has gone. Its bills are fixed first on the month
 *  screen, where a bill on a returned request may be replaced and keeps the request. Finance and management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const id = String(params.id ?? '');
  const state = await requestState(env, id);
  if (!state) return fail('NOT_FOUND', 'No utility bill is on that payment request.', 404);
  if (!RETURNED.has(state.status)) return fail('NOT_RETURNED', `${state.requestNo ?? 'This request'} is still with finance. Only a withdrawn or rejected request is sent again.`, 409);
  const { bills, off } = await billsOnRequest(env, id);
  if (!bills.length) return fail('VALIDATION', `No bill on ${state.requestNo ?? 'this request'} is left for the company to pay.`, 422);
  const res = await forwardClaims(env, session, 'POST', `/utility-bills/payment-request/${encodeURIComponent(id)}/resubmit`, {
    bills: bills.map(({ unitId, kind, billMonth, accountNo, amountSen }) => ({ unitId, kind, billMonth, accountNo, amountSen })),
  });
  if (!res.ok) return res;
  const sent = await res.json<{ id?: string; requestNo?: string; amountSen?: number }>().catch(() => null);
  const unlinked = await unlinkRequest(env, off);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_payment_request_resent', entityTable: 'expenses', entityId: id,
    before: { status: state.status, reason: state.reason, decidedBy: state.decidedBy },
    after: { requestNo: state.requestNo, bills: bills.length, unlinked, amountSen: bills.reduce((n, x) => n + x.amountSen, 0) } });
  return json({ id, requestNo: sent?.requestNo ?? state.requestNo, amountSen: sent?.amountSen ?? null, bills: bills.length, unlinked });
};
