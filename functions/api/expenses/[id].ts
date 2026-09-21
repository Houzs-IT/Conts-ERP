import { type Env, one, run, json, fail, audit } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { EXPENSE_CATEGORIES, CHARGE_TO, isPeriodLocked } from '../../_lib/expenses';

/** PATCH /api/expenses/:id { category?, description?, amount?, incurredOn?, reference?, chargeTo? }
 *  Refused once the statement covering the expense is final, and also if the new date would land in a final statement. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Only finance and management can change expenses.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to change.', 422);
  const fields: Record<string, string> = {};
  if (b.category !== undefined && !EXPENSE_CATEGORIES.includes(b.category)) fields.category = 'Choose a category.';
  if (b.amount !== undefined && (!Number.isInteger(b.amount) || b.amount < 0)) fields.amount = 'Enter an amount of RM 0.00 or more.';
  if (b.incurredOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.incurredOn))) fields.incurredOn = 'A date is required.';
  if (b.chargeTo !== undefined && !CHARGE_TO.includes(b.chargeTo)) fields.chargeTo = 'Choose who is charged.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the highlighted fields.', 422, fields);

  const cur = await one<any>(env, 'SELECT id, unit_id, category, amount, incurred_on, description, reference, charge_to FROM expenses WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That expense no longer exists.', 404);
  if (await isPeriodLocked(env, cur.unit_id, cur.incurred_on)) return fail('PERIOD_LOCKED', 'The owner statement for that month is final, so this expense is locked.', 409);
  if (b.incurredOn && await isPeriodLocked(env, cur.unit_id, b.incurredOn)) return fail('PERIOD_LOCKED', 'That month\'s owner statement is already final.', 409, { incurredOn: 'This period is locked.' });

  await run(env, `
    UPDATE expenses SET category = COALESCE(?, category), description = COALESCE(?, description), amount = COALESCE(?, amount),
                        incurred_on = COALESCE(?, incurred_on), reference = COALESCE(?, reference), charge_to = COALESCE(?, charge_to) WHERE id = ?`,
    b.category ?? null, typeof b.description === 'string' ? b.description.slice(0, 300) : null, b.amount ?? null, b.incurredOn ?? null,
    typeof b.reference === 'string' ? b.reference : null, b.chargeTo ?? null, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'expense.update', entityTable: 'expenses', entityId: id,
    before: { category: cur.category, amount: cur.amount, incurredOn: cur.incurred_on }, after: { category: b.category ?? cur.category, amount: b.amount ?? cur.amount, incurredOn: b.incurredOn ?? cur.incurred_on },
  });
  return json({ ok: true });
};
