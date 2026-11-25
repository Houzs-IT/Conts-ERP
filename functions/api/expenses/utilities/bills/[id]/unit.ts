import { type Env, one, run, json, fail, audit, nowIso, transaction, inDemo } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { isExpenseLocked, isUtility, utilityDeduction } from '../../../../../_lib/expenses';
import { DEMO_NOTHING_SENT, forwardClaims } from '../../../../../_lib/claimsForward';
import { billsOnRequest, requestState, RETURNED } from '../../../../../_lib/utilityRequests';
import { editNotices, keptCostProblem, o2Date, unitLabel } from '../../../../../_lib/lockGuards';
import { costStageOf } from '../../../../../_lib/stageLocks';

const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };

/** POST /api/expenses/utilities/bills/:id/unit { unitId }
 *  A utility bill recorded to the wrong unit moved to the right one (chew, 20 Nov 2026: "如果选错 unit 可以改吗"), with
 *  everything that hangs on it, so nobody has to delete it and enter it again:
 *  - the bill itself, on the new unit's first open deduction month for its bill month (a late bill there as anywhere);
 *  - its owner lines (the owner's own part, the days outside the contract, the credit of a bill the owner paid), on the
 *    new unit and its owner, dated for that owner's open O2 month; the figures stay as they are, so a part worked out from
 *    the old unit's contract days is changed afterwards with Edit amount if it no longer fits;
 *  - its page, now the new unit's receipt;
 *  - the utility account the scan added for it on the old unit, when no other bill there uses it, so next month's page
 *    matches the right unit by itself;
 *  - a payment request still waiting names the new unit in the engine first (refused there once a voucher or an AP
 *    invoice is on it, and then nothing changes); one that came back goes with Send again; one being paid is refused.
 *  Refused when either unit's statement for it is final, a cost or O2 lock keeps it or its owner lines, or the new unit
 *  already has that bill for the month. Finance and management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const id = String(params.id ?? '');
  const b = await request.json<{ unitId?: unknown }>().catch(() => null);
  const to = typeof b?.unitId === 'string' ? b.unitId : '';
  if (!to) return fail('VALIDATION', 'Pick the unit the bill belongs to.', 422, { unitId: 'Pick a unit.' });

  const cur = await one<{ unit_id: string; category: string; incurred_on: string; deduct_month: string; reference: string | null; description: string | null; charge_to: string;
    payment_request_id: string | null; receipt_document_id: string | null }>(env,
    `SELECT unit_id, category, left(incurred_on::text, 10) AS incurred_on, deduct_month, reference, description, charge_to, payment_request_id, receipt_document_id FROM expenses WHERE id = ?`, id);
  if (!cur || !isUtility(cur.category)) return fail('NOT_FOUND', 'That utility bill no longer exists.', 404);
  /* A bill split across units (chew, 25 Nov 2026) changes as a whole: undo the split (DELETE .../split), change it, split it again. */
  if (await one(env, 'SELECT 1 AS x FROM expenses WHERE split_of = ? OR (id = ? AND split_of IS NOT NULL) LIMIT 1', id, id)) return fail('SPLIT', 'This bill is split with other units. Undo the split first.', 409);
  if (cur.unit_id === to) return json({ ok: true, unchanged: true });
  const unit = await one<{ id: string; owner_id: string | null }>(env, 'SELECT id, owner_id FROM units WHERE id = ?', to);
  if (!unit) return fail('VALIDATION', 'That unit no longer exists.', 422, { unitId: 'Pick another unit.' });
  if (await isExpenseLocked(env, cur)) return fail('PERIOD_LOCKED', 'The owner statement for this bill is final, so it stays on its unit.', 409);
  const kept = await keptCostProblem(env, id);
  if (kept) return fail('PERIOD_LOCKED', kept, 409);

  const lines = await one<{ n: number; frozen: number }>(env, `
    SELECT count(*)::int AS n, count(*) FILTER (WHERE a.state = 'settled' OR (s.id IS NOT NULL AND s.state <> 'provisional')
      OR EXISTS (SELECT 1 FROM owner_report_locks k WHERE k.stage = 'o2' AND k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id))))::int AS frozen
    FROM owner_adjustments a LEFT JOIN owner_statements s ON s.id = a.statement_id WHERE a.expense_id = ?`, id);
  if (lines?.frozen) return fail('LOCKED', 'The owner’s lines for this bill are on a closed owner statement, so it stays on its unit.', 409);
  if (lines?.n && !unit.owner_id) return fail('VALIDATION', 'That unit has no owner to put this bill’s owner lines on.', 422, { unitId: 'This unit has no owner.' });

  const month = cur.incurred_on.slice(0, 7);
  const there = await one(env, `SELECT 1 AS x FROM expenses WHERE unit_id = ? AND category = ? AND coalesce(reference, '') = coalesce(?, '') AND incurred_on >= ? AND incurred_on <= ? AND id <> ? LIMIT 1`,
    to, cur.category, cur.reference, `${month}-01`, lastDay(month), id);
  if (there) return fail('ALREADY_RECORDED', `${await unitLabel(env, to)} already has this bill for that month.`, 409, { unitId: 'Already has this bill.' });
  const { deductMonth, rolled } = await utilityDeduction(env, to, cur.incurred_on);

  // The request first: the engine refuses once a voucher or an AP invoice is on it, and then nothing here changes.
  const state = cur.payment_request_id ? await requestState(env, cur.payment_request_id) : null;
  let resentTo: string | null = null;
  if (state && !RETURNED.has(state.status)) {
    if (state.status !== 'SUBMITTED') return fail('BEING_PAID', `${state.requestNo ?? 'Its payment request'} is already being paid, so this bill stays on its unit.`, 409);
    if (inDemo()) return fail('DEMO_MODE', DEMO_NOTHING_SENT, 409);
    const { bills } = await billsOnRequest(env, state.id);
    const res = await forwardClaims(env, session, 'POST', `/utility-bills/payment-request/${encodeURIComponent(state.id)}/bills`, {
      bills: bills.map(({ expenseId, unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen }) =>
        ({ unitId: expenseId === id ? to : unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen })),
    });
    if (!res.ok) return res;
    resentTo = state.requestNo ?? state.id;
  }

  const at = nowIso();
  const occurredOn = unit.owner_id ? (await o2Date(env, unit.owner_id, to, `${deductMonth}-01`)).occurredOn : null;
  const account = await transaction(env, async tx => {
    await run(tx, 'UPDATE expenses SET unit_id = ?, deduct_month = ?, rolled = ? WHERE id = ?', to, deductMonth, rolled, id);
    if (lines?.n) {
      await run(tx, 'UPDATE owner_adjustments SET unit_id = ?, owner_id = ?, occurred_on = ?, statement_id = NULL, updated_at = ? WHERE expense_id = ?', to, unit.owner_id, occurredOn, at, id);
    }
    if (cur.receipt_document_id) await run(tx, 'UPDATE documents SET unit_id = ? WHERE id = ? AND unit_id = ?', to, cur.receipt_document_id, cur.unit_id);
    // The account a scan added on the wrong unit goes along when nothing else there is billed on it and the new unit has none like it.
    if (!cur.reference) return null;
    const moved = await one<{ id: string }>(tx, `
      UPDATE unit_utility_accounts a SET unit_id = ?, updated_at = ?
      WHERE a.unit_id = ? AND a.kind = ? AND a.account_no = ?
        AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.unit_id = a.unit_id AND e.category = a.kind AND e.reference = a.account_no)
        AND NOT EXISTS (SELECT 1 FROM unit_utility_accounts o WHERE o.unit_id = ? AND o.kind = a.kind AND o.account_no = a.account_no)
      RETURNING a.id`, to, at, cur.unit_id, cur.category, cur.reference, to);
    return moved?.id ?? null;
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_bill_unit_changed', entityTable: 'expenses', entityId: id,
    before: { unitId: cur.unit_id, deductMonth: cur.deduct_month }, after: { unitId: to, deductMonth, ownerLines: lines?.n ?? 0, account, request: resentTo } });
  const stage = costStageOf(cur.category, cur.description);
  const notice = cur.charge_to === 'owner'
    ? await editNotices(env, { unitId: cur.unit_id, deductMonth: cur.deduct_month, stage }, { unitId: to, deductMonth, stage })
    : null;
  return json({ ok: true, unitId: to, deductMonth, rolled, ownerLines: lines?.n ?? 0, accountMoved: !!account, request: resentTo, notice });
};
