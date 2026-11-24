import { type Env, fail, json, audit, inDemo } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { DEMO_NOTHING_SENT, forwardClaims } from '../../../../../_lib/claimsForward';
import { billPages, billsOnRequest, moveRequest, providersOf, requestKey, requestState, RETURNED } from '../../../../../_lib/utilityRequests';

/** Bills made into requests of their own per call; the rest wait for the next call, which goes on where this one ended. */
const PER_CALL = 10;
const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };

/** POST /api/expenses/utilities/payment-requests/:id/split
 *  A utility payment request made before 18 Nov 2026, when a scan's bills went to finance as one request per provider,
 *  split into one request per bill (chew, 20 Nov 2026; finance: "one unit per payment for accounting purpose"). The first
 *  bill stays on the request and its number; each other bill goes to finance as a request of its own, with its page.
 *  - A request still waiting keeps only its first bill in the engine (refused there once a voucher or an AP invoice is on
 *    it, and then nothing changes) and takes that bill's page when it has no file.
 *  - A request that came back keeps its first bill here; Send again sends it with that bill alone.
 *  Up to 10 bills per call; `left` says how many are still on the request, and calling again goes on. Calling again on a
 *  request already split changes nothing: each bill's request is named by the request and the bill. Finance and
 *  management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  if (inDemo()) return fail('DEMO_MODE', DEMO_NOTHING_SENT, 409);
  const id = String(params.id ?? '');
  const state = await requestState(env, id);
  if (!state) return fail('NOT_FOUND', 'No utility bill is on that payment request.', 404);
  const waiting = state.status === 'SUBMITTED';
  if (!waiting && !RETURNED.has(state.status)) return fail('BEING_PAID', `${state.requestNo ?? 'This request'} is already being paid, so it is not split.`, 409);
  const { bills } = await billsOnRequest(env, id);
  if (bills.length <= 1) return json({ id, requestNo: state.requestNo, made: [], left: 0 });
  const [keep, ...others] = bills;
  const rest = others.slice(0, PER_CALL);
  const [providers, pages] = await Promise.all([providersOf(env, rest.map(b => b.expenseId)), billPages(env, [keep!.expenseId, ...rest.map(b => b.expenseId)])]);
  const line = ({ unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen }: typeof keep) => ({ unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen });
  const page = (expenseId: string) => (pages.has(expenseId) ? [pages.get(expenseId)!] : undefined);

  if (waiting) {
    const res = await forwardClaims(env, session, 'POST', `/utility-bills/payment-request/${encodeURIComponent(id)}/bills`, { bills: [line(keep!)], files: page(keep!.expenseId) });
    if (!res.ok) return res;
  }
  /* One at a time: each answer names the request its bill moves to, and a refusal stops here with the rest unmoved. */
  const moves: { expenseId: string; id: string; requestNo: string | null }[] = [];
  let refused: Response | null = null;
  for (const b of rest) {
    const res = await forwardClaims(env, session, 'POST', '/utility-bills/payment-request', {
      provider: providers.get(b.expenseId) ?? KIND_LABEL[b.kind] ?? 'Utility', scanBatchId: `split-${(await requestKey([id, b.expenseId])).slice(6)}`,
      note: `${KIND_LABEL[b.kind] ?? 'Utility'} bill ${b.billMonth}, split from ${state.requestNo ?? 'a grouped request'}: one request per bill.`,
      bills: [line(b)], files: page(b.expenseId),
    });
    const made = res.ok ? await res.json<{ id?: string; requestNo?: string }>().catch(() => null) : null;
    if (!made?.id) { refused = res.ok ? fail('ENGINE_REFUSED', 'The finance system did not say which request it made. Try again.', 424) : res; break; }
    moves.push({ expenseId: b.expenseId, id: made.id, requestNo: made.requestNo ?? null });
  }
  const moved = await moveRequest(env, id, moves);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_payment_request_split', entityTable: 'expenses', entityId: id,
    before: { requestNo: state.requestNo, status: state.status, bills: bills.length },
    after: { kept: keep!.expenseId, moved, made: moves.map(m => m.requestNo) } });
  if (refused && !moves.length) return refused;
  return json({ id, requestNo: state.requestNo, made: moves.map(m => ({ expenseId: m.expenseId, requestNo: m.requestNo })), left: others.length - moved,
    ...(refused ? { stopped: 'The finance system refused one bill; call again to go on.' } : {}) });
};
