import { type Env, one, run, json, fail, audit } from '../../_lib/db';
import { rmText } from '../../_lib/format';
import { requireSession } from '../../_lib/auth';
import { isIsoDate } from '../../_lib/validate';
import { EXPENSE_CATEGORIES, CHARGE_TO, EXPENSE_FROM, LOCKED_SQL, expenseOut, isPeriodLocked, isExpenseLocked, isUtility, utilityDeduction, expenseCategoryLabel, expenseDayLabel } from '../../_lib/expenses';
import { approvalSettings, approvalsEnabled, stage } from '../../_lib/approvals';
import { receiptRequired, RECEIPT_REQUIRED } from '../../../src/lib/receipts';

/** GET /api/expenses/:id — one expense as the Accounts payable list shows it, for a link that opens it (the top-bar search). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Expenses are visible to finance and management roles.', 403);
  const row = await one<any>(env, `SELECT e.*, u.unit_number, p.name AS property_name, ${LOCKED_SQL} AS locked ${EXPENSE_FROM} WHERE e.id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That expense no longer exists.', 404);
  return json(expenseOut(row));
};

/** PATCH /api/expenses/:id { category?, description?, amount?, incurredOn?, reference?, chargeTo?, receiptDocumentId? }
 *  Refused once the statement that deducts the expense is final, and for anything but a utility bill also if the new
 *  date would land in a final statement; a utility bill moved into a final month goes on the next open statement.
 *  Attaching a receipt alone is allowed on a final month: it changes no figure, and an older bill without one is
 *  flagged "No receipt" until someone adds it. Turning a bill into one the owner pays needs its receipt. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only finance and management can change expenses.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to change.', 422);
  const fields: Record<string, string> = {};
  if (b.category !== undefined && !EXPENSE_CATEGORIES.includes(b.category)) fields.category = 'Choose a category.';
  if (b.amount !== undefined && (!Number.isInteger(b.amount) || b.amount < 0)) fields.amount = 'Enter an amount of RM 0.00 or more.';
  if (b.incurredOn !== undefined && !isIsoDate(String(b.incurredOn))) fields.incurredOn = 'A date is required.';
  if (b.chargeTo !== undefined && !CHARGE_TO.includes(b.chargeTo)) fields.chargeTo = 'Choose who pays.';
  if (b.receiptDocumentId !== undefined && (typeof b.receiptDocumentId !== 'string' || !b.receiptDocumentId)) fields.receipt = 'Upload the receipt again.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the highlighted fields.', 422, fields);

  const cur = await one<any>(env, 'SELECT id, unit_id, category, amount, incurred_on, deduct_month, rolled, description, reference, charge_to, receipt_document_id FROM expenses WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That expense no longer exists.', 404);
  if (b.receiptDocumentId !== undefined && !(await one(env, "SELECT 1 AS x FROM documents WHERE id = ? AND kind = 'receipt' AND (unit_id IS NULL OR unit_id = ?)", b.receiptDocumentId, cur.unit_id))) {
    return fail('VALIDATION', 'That receipt was not found. Upload it again.', 422, { receipt: 'Upload the receipt again.' });
  }
  const changesMoney = ['category', 'description', 'amount', 'incurredOn', 'reference', 'chargeTo'].some(k => b[k] !== undefined);
  if (!changesMoney && b.receiptDocumentId) {
    await run(env, 'UPDATE expenses SET receipt_document_id = ? WHERE id = ?', b.receiptDocumentId, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.receipt', entityTable: 'expenses', entityId: id,
      before: { receiptDocumentId: cur.receipt_document_id ?? null }, after: { receiptDocumentId: b.receiptDocumentId } });
    return json({ ok: true });
  }
  const becomesOwnerBill = !receiptRequired(cur.category, cur.charge_to) && receiptRequired(b.category ?? cur.category, b.chargeTo ?? cur.charge_to);
  if (becomesOwnerBill && !cur.receipt_document_id && !b.receiptDocumentId) return fail('RECEIPT_REQUIRED', RECEIPT_REQUIRED, 422, { receipt: RECEIPT_REQUIRED });
  if (await isExpenseLocked(env, cur)) return fail('PERIOD_LOCKED', 'The owner statement for that month is final, so this expense is locked.', 409);
  // A utility bill's statement follows its date: its own month, or the next open one when that month is final.
  const category = b.category ?? cur.category, day = b.incurredOn ?? cur.incurred_on;
  const deduction = isUtility(category) && (b.incurredOn !== undefined || b.category !== undefined) ? await utilityDeduction(env, cur.unit_id, day) : null;
  if (!deduction && b.incurredOn && await isPeriodLocked(env, cur.unit_id, b.incurredOn)) return fail('PERIOD_LOCKED', 'That month\'s owner statement is already final.', 409, { incurredOn: 'This period is locked.' });

  const { expenseThreshold } = await approvalSettings(env);
  if (b.amount !== undefined && b.amount > expenseThreshold && b.amount > Number(cur.amount) && await approvalsEnabled(env)) {
    // With approvals on, raising an expense above the threshold needs the same second person as adding one that size.
    const changes = { category: b.category ?? null, description: typeof b.description === 'string' ? b.description.slice(0, 300) : null, amount: b.amount,
      incurredOn: b.incurredOn ?? null, reference: typeof b.reference === 'string' ? b.reference : null, chargeTo: b.chargeTo ?? null };
    const staged = await stage(env, session, {
      kind: 'expense', entity: 'units', entityId: cur.unit_id, amount: b.amount,
      reason: String(b.reason ?? '').trim() || `Expense raised from RM ${(Number(cur.amount) / 100).toFixed(2)} to RM ${(b.amount / 100).toFixed(2)}`,
      summary: `${expenseCategoryLabel(cur.category)} expense of ${expenseDayLabel(cur.incurred_on)} raised from ${rmText(Number(cur.amount))} to ${rmText(b.amount)}`,
      payload: { op: 'update', expenseId: id, unitId: cur.unit_id, changes },
    });
    return json(staged, 202);
  }

  await run(env, `
    UPDATE expenses SET category = COALESCE(?, category), description = COALESCE(?, description), amount = COALESCE(?, amount),
                        incurred_on = COALESCE(?, incurred_on), reference = COALESCE(?, reference), charge_to = COALESCE(?, charge_to),
                        receipt_document_id = COALESCE(?, receipt_document_id), deduct_month = COALESCE(?, deduct_month), rolled = COALESCE(?, rolled) WHERE id = ?`,
    b.category ?? null, typeof b.description === 'string' ? b.description.slice(0, 300) : null, b.amount ?? null, b.incurredOn ?? null,
    typeof b.reference === 'string' ? b.reference : null, b.chargeTo ?? null, b.receiptDocumentId ?? null, deduction?.deductMonth ?? null, deduction?.rolled ?? null, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'expense.update', entityTable: 'expenses', entityId: id,
    before: { category: cur.category, amount: cur.amount, incurredOn: cur.incurred_on, chargeTo: cur.charge_to },
    after: { category: b.category ?? cur.category, amount: b.amount ?? cur.amount, incurredOn: b.incurredOn ?? cur.incurred_on, chargeTo: b.chargeTo ?? cur.charge_to },
  });
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only finance and management can remove expenses.', 403);

  const id = String(params.id);
  const cur = await one<{ unit_id: string; deduct_month: string; category: string; amount: number; incurred_on: string; description: string | null; charge_to: string }>(env,
    'SELECT unit_id, deduct_month, category, amount, incurred_on, description, charge_to FROM expenses WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That expense no longer exists.', 404);
  if (await isExpenseLocked(env, cur)) return fail('PERIOD_LOCKED', 'The owner statement for that month is final, so this expense is locked.', 409);
  if (await one(env, 'SELECT 1 AS x FROM expenses WHERE parent_expense_id = ? LIMIT 1', id)) return fail('HAS_LINE_ITEMS', 'This bill has line items under it. Remove those first.', 409);

  await run(env, 'DELETE FROM expenses WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.delete', entityTable: 'expenses', entityId: id,
    before: { unitId: cur.unit_id, category: cur.category, amount: cur.amount, incurredOn: cur.incurred_on, description: cur.description, chargeTo: cur.charge_to }, after: null });
  return json({ ok: true });
};
