import { type Env, one, run, json, fail, audit, nowIso, transaction, inDemo } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { rmText } from '../../../../_lib/format';
import { isExpenseLocked, isUtility } from '../../../../_lib/expenses';
import { approvalSettings, approvalsEnabled } from '../../../../_lib/approvals';
import { DEMO_NOTHING_SENT, forwardClaims } from '../../../../_lib/claimsForward';
import { billsOnRequest, ownerOwnPart, ownerPaidCredit, requestState, RETURNED } from '../../../../_lib/utilityRequests';
import { editNotices } from '../../../../_lib/lockGuards';
import { costStageOf } from '../../../../_lib/stageLocks';
import { billEdit, billEditProblem, partNow, shareNow } from '../../../../../src/lib/utilityBillEdit';

/** PATCH /api/expenses/utilities/bills/:id { amount, ownerPart?, ownerPaid? }
 *  One utility bill's amount changed from its cell on Utility bills (chew, 19 Nov 2026: click it and edit it there, as
 *  long as the payment is not processed). `amount` is the whole bill, in sen, as the provider printed it.
 *  - The owner's own part (a typed part and the days outside the contract) stays as it is unless `ownerPart` is given:
 *    then it replaces them as one owner line (chew, 19 Nov 2026), refused when an O2 lock keeps one of them. The shared
 *    part is the rest, so a whole bill at or below the owner's part is refused.
 *  - A bill the owner paid moves its credit with it, while that credit is not kept by an O2 lock.
 *  - On a request still waiting for payment the engine takes the new amount on the same request first (refused once a
 *    voucher or an AP invoice is on it); on a request that came back the bill changes here and goes with Send again;
 *    on one being paid or paid it is refused.
 *  - A scanned record-only bill (the whole bill the owner's) can be changed too (chew, 20 Nov 2026: anything whose
 *    voucher is not processed): it stays the owner's unless a smaller owner part is given, which puts the rest back on
 *    the shared costs; an owner part equal to the whole makes any bill record only (see src/lib/utilityBillEdit.ts).
 *  - `ownerPaid: true` marks a bill the owner paid the provider himself (chew, 20 Nov 2026: a unit changed owner after
 *    its bill was sent for payment): the company no longer pays it, so it lets go of its request, and the whole bill
 *    goes back to the unit's owner as an open O2 credit, as "Owner paid this bill" does on entry. Only on a bill with no
 *    request or one that came back: a request still waiting is taken back here first (withdrawn, or sent on without
 *    this bill), so finance never pays it; refused once a voucher is on it.
 *  Refused once the bill's statement is final. Finance and management only. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const id = String(params.id ?? '');
  const b = await request.json<{ amount?: unknown; ownerPart?: unknown; ownerPaid?: unknown }>().catch(() => null);
  const total = Number(b?.amount);
  if (!Number.isInteger(total) || total <= 0) return fail('VALIDATION', 'Enter the whole bill, more than RM 0.00.', 422, { amount: 'Enter the whole bill.' });
  const newPart = b?.ownerPart == null ? null : Number(b.ownerPart);

  const cur = await one<{ id: string; unit_id: string; owner_id: string | null; reference: string | null; category: string; amount: number; incurred_on: string; deduct_month: string; rolled: boolean; description: string | null;
    charge_to: string; owner_paid: boolean; record_only: boolean; payment_request_id: string | null; scan_id: string | null; bill_sen: number | null; part: number | null }>(env, `
    SELECT e.id, e.unit_id, (SELECT u.owner_id FROM units u WHERE u.id = e.unit_id) AS owner_id, e.reference, e.category, e.amount, e.incurred_on, e.deduct_month, e.rolled, e.description, e.charge_to, coalesce(e.owner_paid, false) AS owner_paid,
           coalesce(e.record_only, false) AS record_only, e.payment_request_id, s.id AS scan_id, s.bill_sen,
           (SELECT -sum(o.amount) FROM owner_adjustments o WHERE o.expense_id = e.id AND o.kind = 'charge') AS part
    FROM expenses e LEFT JOIN utility_bill_scans s ON s.expense_id = e.id WHERE e.id = ?`, id);
  if (!cur || !isUtility(cur.category)) return fail('NOT_FOUND', 'That utility bill no longer exists.', 404);
  /* A bill split across units (chew, 25 Nov 2026) changes as a whole: undo the split (DELETE .../split), change it, split it again. */
  if (await one(env, 'SELECT 1 AS x FROM expenses WHERE split_of = ? OR (id = ? AND split_of IS NOT NULL) LIMIT 1', id, id)) return fail('SPLIT', 'This bill is split with other units. Undo the split, change it, then split it again.', 409);
  // A record-only bill kept from AutoCount has no owner lines to follow it, so it stays as it is.
  if (cur.record_only && !cur.scan_id) return fail('RECORD_ONLY', 'This bill is kept for the records only, so it is changed in the unit’s Costs.', 409);
  if (await isExpenseLocked(env, cur)) return fail('PERIOD_LOCKED', 'The owner statement for that month is final, so this bill is locked.', 409);
  const was = cur.bill_sen != null ? Number(cur.bill_sen) : Number(cur.amount) + Number(cur.part ?? 0);
  const now = { whole: was, amount: Number(cur.amount), recordOnly: cur.record_only };
  const wasPart = partNow(now);
  const next = billEdit(now, total, newPart);
  const problem = billEditProblem(next);
  if (problem) return fail('VALIDATION', next.share < 0 ? `The owner's own part is ${rmText(next.ownerPart)}; the whole bill must be at least that.` : problem, 422,
    next.share < 0 ? { amount: 'At least the owner’s own part.' } : { ownerPart: 'Check the amount.' });
  const { ownerPart, share, recordOnly } = next;
  const markPaid = b?.ownerPaid === true && !cur.owner_paid;
  if (b?.ownerPaid === false && cur.owner_paid) return fail('VALIDATION', 'A bill the owner paid is changed back by removing it in the unit’s Costs and entering it again.', 422);
  if (total === was && ownerPart === wasPart && !markPaid) return json({ ok: true, unchanged: true });
  if (markPaid && !cur.owner_id) return fail('VALIDATION', 'This unit has no owner to give the bill back to.', 422);
  // A new owner part replaces the bill's owner lines (the typed part, the days outside the contract) as one line.
  const partLines = ownerPart !== wasPart ? await one<{ n: number; kept: number }>(env, `
    SELECT count(*)::int AS n, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM owner_report_locks k WHERE k.stage = 'o2'
      AND k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id))))::int AS kept
    FROM owner_adjustments a WHERE a.expense_id = ? AND a.kind = 'charge'`, id) : null;
  if (partLines?.kept) return fail('LOCKED', 'The owner’s part of this bill is on a closed owner statement. Change it from the owner statement instead.', 409);
  if (partLines && ownerPart > 0 && !cur.owner_id) return fail('VALIDATION', 'This unit has no owner to charge the owner’s part to.', 422);
  const { expenseThreshold } = await approvalSettings(env);
  if (share > expenseThreshold && share > shareNow(now) && await approvalsEnabled(env)) {
    return fail('NEEDS_APPROVAL', 'A bill raised above the approval limit needs a second person: change it from the unit’s Costs, where it goes for approval.', 409);
  }
  // A bill the owner paid gives the owner its credit back; an O2 lock that keeps the credit keeps the bill too.
  const credit = cur.owner_paid ? await one<{ id: string; kept: boolean }>(env, `
    SELECT a.id, EXISTS (SELECT 1 FROM owner_report_locks k WHERE k.stage = 'o2' AND k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id))) AS kept
    FROM owner_adjustments a WHERE a.expense_id = ? AND a.kind = 'credit' LIMIT 1`, id) : null;
  if (credit?.kept) return fail('LOCKED', 'The owner’s credit for this bill is on a closed owner statement. Change it from the owner statement instead.', 409);

  // The request first: the engine refuses once a voucher or an AP invoice is on it, and then nothing here changes.
  const state = cur.payment_request_id ? await requestState(env, cur.payment_request_id) : null;
  // A request still waiting is taken back first (chew, 20 Nov 2026: tick it straight away), whoever sent it: withdrawn when
  // this is its only bill, else sent on without it. The engine refuses once a voucher or an AP invoice is on it.
  let withdrawn: string | null = null;
  if (markPaid && state && !RETURNED.has(state.status)) {
    if (state.status !== 'SUBMITTED') return fail('BEING_PAID', `${state.requestNo ?? 'Its payment request'} is already being paid, so this bill can no longer be marked.`, 409);
    if (inDemo()) return fail('DEMO_MODE', DEMO_NOTHING_SENT, 409);
    const others = (await billsOnRequest(env, state.id)).bills.filter(x => x.expenseId !== id);
    const res = others.length
      ? await forwardClaims(env, session, 'POST', `/utility-bills/payment-request/${encodeURIComponent(state.id)}/bills`, {
          bills: others.map(({ unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen }) => ({ unitId, kind, billMonth, billDate, dueDate, accountNo, amountSen })) })
      : await forwardClaims(env, session, 'POST', `/utility-bills/payment-request/${encodeURIComponent(state.id)}/withdraw`, {});
    if (!res.ok) return res;
    withdrawn = others.length ? null : state.requestNo ?? state.id;
  }
  let resentTo: string | null = null;
  if (!markPaid && state && !RETURNED.has(state.status) && total !== was) {
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

  const at = nowIso();
  await transaction(env, async tx => {
    // A record-only bill carries the whole bill as its amount and stays off the shared costs.
    await run(tx, 'UPDATE expenses SET amount = ?, record_only = ? WHERE id = ?', recordOnly ? total : share, recordOnly, id);
    if (cur.scan_id) await run(tx, 'UPDATE utility_bill_scans SET bill_sen = ? WHERE id = ?', total, cur.scan_id);
    if (credit) await run(tx, 'UPDATE owner_adjustments SET amount = ?, updated_at = ? WHERE id = ?', total, at, credit.id);
    if (markPaid) {
      // Off its request (a returned one sends again without it) and back to the owner in full.
      await run(tx, 'UPDATE expenses SET owner_paid = true, payment_request_id = NULL, payment_request_no = NULL WHERE id = ?', id);
      await ownerPaidCredit(tx, { expenseId: id, unitId: cur.unit_id, ownerId: cur.owner_id!, kind: cur.category, label: cur.description ?? 'Utility bill',
        amountSen: total, deductMonth: cur.deduct_month, accountNo: cur.reference }, session.userId, at);
    }
    if (partLines) {
      // The days split no longer stands once the part is set by hand, so the bill drops its "N of M days" note.
      const label = (cur.description ?? 'Utility bill').replace(/, \d+ of \d+ days in the contract$/, '');
      await run(tx, 'UPDATE expenses SET description = ? WHERE id = ?', label, id);
      await run(tx, "DELETE FROM owner_adjustments WHERE expense_id = ? AND kind = 'charge'", id);
      if (ownerPart > 0) await ownerOwnPart(tx, { expenseId: id, unitId: cur.unit_id, ownerId: cur.owner_id!, label,
        amountSen: ownerPart, deductMonth: cur.deduct_month, accountNo: cur.reference }, session.userId, at);
    }
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_bill_changed', entityTable: 'expenses', entityId: id,
    before: { bill: was, share: shareNow(now), ownerPart: wasPart, recordOnly: cur.record_only }, after: { bill: total, share, ownerPart, recordOnly, request: resentTo, ...(markPaid ? { ownerPaid: true, offRequest: state?.requestNo ?? null, withdrawn } : {}) } });
  // A month whose deductions are locked keeps its figures; the difference goes to the next open month (as PATCH /expenses/:id).
  const notice = cur.charge_to === 'owner'
    ? await editNotices(env, { unitId: cur.unit_id, deductMonth: cur.deduct_month, stage: costStageOf(cur.category, cur.description) },
        { unitId: cur.unit_id, deductMonth: cur.deduct_month, stage: costStageOf(cur.category, cur.description) })
    : null;
  return json({ ok: true, bill: total, share, ownerPart, request: resentTo, withdrawn, ownerPaid: markPaid || cur.owner_paid, notice });
};
