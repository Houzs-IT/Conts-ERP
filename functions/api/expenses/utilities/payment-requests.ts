import { type Env, fail, json, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { forwardClaims } from '../../../_lib/claimsForward';
import { billsToRequest, linkRequest, requestKey } from '../../../_lib/utilityRequests';

/** POST /api/expenses/utilities/payment-requests { expenseIds, provider }
 *  Utility bills entered by hand ("Enter this month's bills", "Add utility bill") that the company pays go to finance as
 *  one payment request for the provider, as Scan bills does (chew, 5 Nov 2026; SOP 3.10 "手动录入也一样"). The request is
 *  kept in the engine (conts/utility-bill-routes.ts); each bill then keeps its number. The same bills sent again answer
 *  with the request already made. Bills paid by the owner, record only or already on a request are not sent.
 *  Finance and management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const b = await request.json<{ expenseIds?: unknown; provider?: unknown }>().catch(() => null);
  const ids = Array.isArray(b?.expenseIds) ? [...new Set(b!.expenseIds.map(String).filter(Boolean))].slice(0, 500) : [];
  const provider = String(b?.provider ?? '').trim();
  if (!ids.length || !provider) return fail('VALIDATION', 'Name the bills and the provider.', 422);
  const [group] = await billsToRequest(env, ids, provider);
  if (!group) return fail('NOT_FOUND', `No ${provider} bills here are left for the company to pay.`, 404);
  const sent = group.bills.map(x => x.expenseId);
  const res = await forwardClaims(env, session, 'POST', '/utility-bills/payment-request', {
    provider, scanBatchId: await requestKey(sent), note: `${sent.length} ${provider} bills entered on the Utility bills screen.`,
    bills: group.bills.map(({ unitId, kind, billMonth, accountNo, amountSen }) => ({ unitId, kind, billMonth, accountNo, amountSen })),
  });
  if (!res.ok) return res;
  const made = await res.json<{ id?: string; requestNo?: string; amountSen?: number }>().catch(() => null);
  if (!made?.id) return fail('ENGINE_REFUSED', 'The finance system did not say which request it made. Try again.', 424);
  const linked = await linkRequest(env, sent, { id: made.id, requestNo: made.requestNo ?? null });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_payment_request', entityTable: 'expenses', entityId: made.id,
    after: { provider, bills: sent.length, linked, amountSen: group.bills.reduce((n, x) => n + x.amountSen, 0), requestNo: made.requestNo ?? null } });
  return json({ id: made.id, requestNo: made.requestNo ?? null, amountSen: made.amountSen ?? null, bills: sent.length }, res.status);
};
