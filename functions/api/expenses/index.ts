import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { resolveUnit } from '../../_lib/ops';
import { EXPENSE_CATEGORIES, CHARGE_TO, isPeriodLocked } from '../../_lib/expenses';
import { approvalSettings, stage } from '../../_lib/approvals';

/** POST /api/expenses { unitId | unitNumber (+propertyName), category, amount, incurredOn, description, reference, chargeTo, receiptDocumentId }
 *  Every deduction needs a category, an amount and a date: that is what makes an owner statement explainable. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'You can view expenses but cannot add them. Ask a Finance Admin for access.', 403);

  const b = await request.json<any>().catch(() => null);
  const fields: Record<string, string> = {};
  if (!b?.unitId && !b?.unitNumber) fields.unitId = 'A unit is required.';
  if (!EXPENSE_CATEGORIES.includes(b?.category)) fields.category = 'Choose a category.';
  if (!Number.isInteger(b?.amount) || b.amount < 0) fields.amount = 'Enter an amount of RM 0.00 or more.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b?.incurredOn ?? ''))) fields.incurredOn = 'A date is required.';
  if (b?.chargeTo !== undefined && !CHARGE_TO.includes(b.chargeTo)) fields.chargeTo = 'Choose who pays.';
  if (b?.receiptDocumentId !== undefined && b.receiptDocumentId !== null && typeof b.receiptDocumentId !== 'string') fields.receipt = 'Upload the receipt again.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Every expense needs a category, amount and date.', 422, fields);

  const unit = await resolveUnit(env, b.unitId ?? b.unitNumber, b.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422, { unitId: 'Pick the building too.' });
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404, { unitId: 'Pick a unit that exists.' });
  if (await isPeriodLocked(env, unit.id, b.incurredOn)) return fail('PERIOD_LOCKED', 'That month\'s owner statement is already final, so nothing can be added to it.', 409, { incurredOn: 'This period is locked.' });

  if (b.receiptDocumentId && !(await one(env, "SELECT 1 AS x FROM documents WHERE id = ? AND kind = 'receipt'", b.receiptDocumentId))) {
    return fail('VALIDATION', 'That receipt was not found. Upload it again.', 422, { receipt: 'Upload the receipt again.' });
  }
  const { expenseThreshold } = await approvalSettings(env);
  if (b.amount > expenseThreshold) {
    // Above Settings > Approvals' threshold the expense waits for a second person (functions/_lib/approvals.ts).
    const label = await one<{ name: string }>(env, `SELECT p.name || ' ' || u.unit_number AS name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, unit.id);
    const staged = await stage(env, session, {
      kind: 'expense', entity: 'units', entityId: unit.id, amount: b.amount,
      reason: String(b.reason ?? '').trim() || String(b.description ?? '').trim() || `${b.category} expense`,
      summary: `Expense RM ${(b.amount / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })} on ${label?.name ?? 'unit'} (${b.category}, ${b.incurredOn})${b.description ? `: ${String(b.description).slice(0, 120)}` : ''}`,
      payload: { op: 'create', unitId: unit.id, category: b.category, description: String(b.description ?? '').slice(0, 300), amount: b.amount, incurredOn: b.incurredOn,
        reference: b.reference ?? null, chargeTo: b.chargeTo ?? 'owner', receiptDocumentId: b.receiptDocumentId ?? null,
        maintenanceId: b.maintenanceId ?? null, taskId: b.taskId ?? null, parentExpenseId: b.parentExpenseId ?? null },
    });
    return json(staged, 202);
  }
  const id = crypto.randomUUID();
  // parent_expense_id is optional: a line item (e.g. labour or parts under a
  // maintenance rollup) points at its parent so the L2→L3 drill-down can nest it.
  // Manually added monthly expenses leave it null and stay top-level.
  await run(env, `
    INSERT INTO expenses (id, unit_id, maintenance_id, task_id, parent_expense_id, category, description, amount, currency, incurred_on, reference, charge_to, receipt_document_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MYR', ?, ?, ?, ?, ?, ?)`,
    id, unit.id, b.maintenanceId ?? null, b.taskId ?? null, b.parentExpenseId ?? null, b.category, String(b.description ?? '').slice(0, 300), b.amount,
    b.incurredOn, b.reference ?? null, b.chargeTo ?? 'owner', b.receiptDocumentId ?? null, session.userId, nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.create', entityTable: 'expenses', entityId: id, after: { unitId: unit.id, category: b.category, amount: b.amount, incurredOn: b.incurredOn, chargeTo: b.chargeTo ?? 'owner' } });
  return json({ id }, 201);
};
