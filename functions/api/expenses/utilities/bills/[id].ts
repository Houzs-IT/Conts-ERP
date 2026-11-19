import { type Env, one, run, json, fail, audit, nowIso, transaction, inDemo } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { rmText } from '../../../../_lib/format';
import { isExpenseLocked, isUtility } from '../../../../_lib/expenses';
import { approvalSettings, approvalsEnabled } from '../../../../_lib/approvals';
import { DEMO_NOTHING_SENT, forwardClaims } from '../../../../_lib/claimsForward';
import { billsOnRequest, ownerOwnPart, requestState, RETURNED } from '../../../../_lib/utilityRequests';
import { editNotices } from '../../../../_lib/lockGuards';
import { costStageOf } from '../../../../_lib/stageLocks';

/** PATCH /api/expenses/utilities/bills/:id { amount, ownerPart? }
 *  One utility bill's amount changed from its cell on Utility bills (chew, 19 Nov 2026: click it and edit it there, as
 *  long as the payment is not processed). `amount` is the whole bill, in sen, as the provider printed it.
 *  - The owner's own part (a typed part and the days outside the contract) stays as it is unless `ownerPart` is given:
 *    then it replaces them as one owner line (chew, 19 Nov 2026), refused when an O2 lock keeps one of them. The shared
 *    part is the rest, so a whole bill at or below the owner's part is refused.
 *  - A bill the owner paid moves its credit with it, while that credit is not kept by an O2 lock.
 *  - On a request still waiting for payment the engine takes the new amount on the same request first (refused once a
 *    voucher or an AP invoice is on it); on a request that came back the bill changes here and goes with Send again;
 *    on one being paid or paid it is refused.
 *  Refused once the bill's statement is final, and when the whole bill is the owner's (record only). Finance and
 *  management only. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const id = String(params.id ?? '');
  const b = await request.json<{ amount?: unknown; ownerPart?: unknown }>().catch(() => null);
  const total = Number(b?.amount);
  if (!Number.isInteger(total) || total <= 0) return fail('VALIDATION', 'Enter the whole bill, more than RM 0.00.', 422, { amount: 'Enter the whole bill.' });
  const newPart = b?.ownerPart == null ? null : Number(b.ownerPart);
  if (newPart != null && (!Number.isInteger(newPart) || newPart < 0)) return fail('VALIDATION', 'The owner’s own part is RM 0.00 or more.', 422, { ownerPart: 'Check the amount.' });

  const cur = await one<{ id: string; unit_id: string; owner_id: string | null; reference: string | null; category: string; amount: number; incurred_on: string; deduct_month: string; rolled: boolean; description: string | null;
    charge_to: string; owner_paid: boolean; record_only: boolean; payment_request_id: string | null; scan_id: string | null; bill_sen: number | null; part: number | null }>(env, `
    SELECT e.id, e.unit_id, (SELECT u.owner_id FROM units u WHERE u.id = e.unit_id) AS owner_id, e.reference, e.category, e.amount, e.incurred_on, e.deduct_month, e.rolled, e.description, e.charge_to, coalesce(e.owner_paid, false) AS owner_paid,
           coalesce(e.record_only, false) AS record_only, e.payment_request_id, s.id AS scan_id, s.bill_sen,
           (SELECT -sum(o.amount) FROM owner_adjustments o WHERE o.expense_id = e.id AND o.kind = 'charge') AS part
    FROM expenses e LEFT JOIN utility_bill_scans s ON s.expense_id = e.id WHERE e.id = ?`, id);
  if (!cur || !isUtility(cur.category)) return fail('NOT_FOUND', 'That utility bill no longer exists.', 404);
  if (cur.record_only) return fail('RECORD_ONLY', 'The whole bill is the owner’s (outside the contract), so it is changed by removing it in the unit’s Costs and scanning it again.', 409);
  if (await isExpenseLocked(env, cur)) return fail('PERIOD_LOCKED', 'The owner statement for that month is final, so this bill is locked.', 409);
  const was = cur.bill_sen != null ? Number(cur.bill_sen) : Number(cur.amount) + Number(cur.part ?? 0);
  const wasPart = was - Number(cur.amount);
  const ownerPart = newPart ?? wasPart;
  const share = total - ownerPart;
  if (share <= 0) return fail('VALIDATION', `The owner's own part is ${rmText(ownerPart)}; the whole bill must be more than that.`, 422, { amount: 'More than the owner’s own part.' });
  if (total === was && ownerPart === wasPart) return json({ ok: true, unchanged: true });
  // A new owner part replaces the bill's owner lines (the typed part, the days outside the contract) as one line.
  const partLines = ownerPart !== wasPart ? await one<{ n: number; kept: number }>(env, `
    SELECT count(*)::int AS n, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM owner_report_locks k WHERE k.stage = 'o2'
      AND k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id))))::int AS kept
    FROM owner_adjustments a WHERE a.expense_id = ? AND a.kind = 'charge'`, id) : null;
  if (partLines?.kept) return fail('LOCKED', 'The owner’s part of this bill is on a closed owner statement. Change it from the owner statement instead.', 409);
  if (partLines && ownerPart > 0 && !cur.owner_id) return fail('VALIDATION', 'This unit has no owner to charge the owner’s part to.', 422);
  const { expenseThreshold } = await approvalSettings(env);
  if (share > expenseThreshold && share > Number(cur.amount) && await approvalsEnabled(env)) {
    return fail('NEEDS_APPROVAL', 'A bill raised above the approval limit needs a second person: change it from the unit’s Costs, where it goes for approval.', 409);
  }
  // A bill the owner paid gives the owner its credit back; an O2 lock that keeps the credit keeps the bill too.
  const credit = cur.owner_paid ? await one<{ id: string; kept: boolean }>(env, `
    SELECT a.id, EXISTS (SELECT 1 FROM owner_report_locks k WHERE k.stage = 'o2' AND k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id))) AS kept
    FROM owner_adjustments a WHERE a.expense_id = ? AND a.kind = 'credit' LIMIT 1`, id) : null;
  if (credit?.kept) return fail('LOCKED', 'The owner’s credit for this bill is on a closed owner statement. Change it from the owner statement instead.', 409);

  // The request first: the engine refuses once a voucher or an AP invoice is on it, and then nothing here changes.
  const state = cur.payment_request_id ? await requestState(env, cur.payment_request_id) : null;
  let resentTo: string | null = null;
  if (state && !RETURNED.has(state.status) && total !== was) {
    if (state.status !== 'SUBMITTED') return fail('BEING_PAID', `${state.requestNo ?? 'Its payment request'} is already being paid, so this bill can no longer be changed.`, 409);
    if (inDemo()) return fail('DEMO_MODE', DEMO_NOTHING_SENT, 409);
    const { bills } = await billsOnRequest(env, state.id);
    const res = await forwardClaims(env, session, 'POST', `/utility-bills/payment-request/${encodeURIComponent(state.id)}/bills`, {
      bills: bills.map(({ expenseId, unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen }) =>
        ({ unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen: expenseId === id ? total : amountSen })),
    });
    if (!res.ok) return res;
    resentTo = state.requestNo ?? state.id;
  }

  const now = nowIso();
  await transaction(env, async tx => {
    await run(tx, 'UPDATE expenses SET amount = ? WHERE id = ?', share, id);
    if (cur.scan_id) await run(tx, 'UPDATE utility_bill_scans SET bill_sen = ? WHERE id = ?', total, cur.scan_id);
    if (credit) await run(tx, 'UPDATE owner_adjustments SET amount = ?, updated_at = ? WHERE id = ?', total, now, credit.id);
    if (partLines) {
      // The days split no longer stands once the part is set by hand, so the bill drops its "N of M days" note.
      const label = (cur.description ?? 'Utility bill').replace(/, \d+ of \d+ days in the contract$/, '');
      await run(tx, 'UPDATE expenses SET description = ? WHERE id = ?', label, id);
      await run(tx, "DELETE FROM owner_adjustments WHERE expense_id = ? AND kind = 'charge'", id);
      if (ownerPart > 0) await ownerOwnPart(tx, { expenseId: id, unitId: cur.unit_id, ownerId: cur.owner_id!, label,
        amountSen: ownerPart, deductMonth: cur.deduct_month, accountNo: cur.reference }, session.userId, now);
    }
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_bill_changed', entityTable: 'expenses', entityId: id,
    before: { bill: was, share: Number(cur.amount), ownerPart: wasPart }, after: { bill: total, share, ownerPart, request: resentTo } });
  // A month whose deductions are locked keeps its figures; the difference goes to the next open month (as PATCH /expenses/:id).
  const notice = cur.charge_to === 'owner'
    ? await editNotices(env, { unitId: cur.unit_id, deductMonth: cur.deduct_month, stage: costStageOf(cur.category, cur.description) },
        { unitId: cur.unit_id, deductMonth: cur.deduct_month, stage: costStageOf(cur.category, cur.description) })
    : null;
  return json({ ok: true, bill: total, share, ownerPart, request: resentTo, notice });
};
