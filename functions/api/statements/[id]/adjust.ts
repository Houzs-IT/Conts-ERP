import { type Env, one, run, json, fail, audit, mytToday } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { checkSen, invalid, type Fields } from '../../../_lib/validate';

/** POST /api/statements/:id/adjust { label, amount }
 *  Records a manual adjustment line on a statement and rebalances the net payout.
 *  amount is integer sen — positive adds to the owner's payout, negative deducts.
 *
 *  Only a statement that is still editable can be adjusted: provisional or finalised.
 *  A sent or paid statement is frozen and must be superseded, not edited (api.md §7).
 *  The stored gross / fee / expenses are never touched — an adjustment is its own line,
 *  so net_payout = gross − fee − expenses + Σ(adjustment lines) stays exact and auditable.
 *
 *  Caveat: regenerating a still-provisional period rebuilds it from bookings and wipes
 *  adjustment lines. Adjust after finalising when the change must persist. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'You can view statements but cannot adjust them. Ask a Finance Admin for access.', 403);

  const id = String(params.id);
  const b = await request.json<{ label?: string; amount?: number }>().catch(() => null);
  const label = (b?.label ?? '').trim();
  const amount = Math.round(Number(b?.amount));
  if (!label) return fail('VALIDATION', 'Describe the adjustment so it is clear on the statement.', 422, { label: 'Required.' });
  if (!Number.isFinite(amount) || amount === 0) return fail('VALIDATION', 'Enter an amount that is not zero.', 422, { amount: 'Enter a non-zero amount.' });
  const fields: Fields = {};
  checkSen(fields, 'amount', b?.amount, { label: 'Amount', required: true, min: Number.MIN_SAFE_INTEGER });
  const bad = invalid(fields); if (bad) return bad;

  const st = await one<any>(env, 'SELECT id, state, gross_booking_value, management_fee, expenses_total, adjustments_total, net_payout FROM owner_statements WHERE id = ?', id);
  if (!st) return fail('NOT_FOUND', 'That statement no longer exists.', 404);
  if (st.state === 'sent' || st.state === 'paid') {
    return fail('STATEMENT_LOCKED', 'This statement has already been sent and cannot be edited, only superseded by a new period.', 409);
  }

  const nextOrder = await one<{ n: number }>(env, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM statement_lines WHERE statement_id = ?', id);
  await run(env, `
    INSERT INTO statement_lines (id, statement_id, unit_id, reservation_id, expense_id, line_type, category, description, occurred_on, amount, reference, sort_order)
    VALUES (?, ?, NULL, NULL, NULL, 'adjustment', 'adjustment', ?, ?, ?, NULL, ?)`,
    crypto.randomUUID(), id, label, mytToday(), amount, Number(nextOrder?.n ?? 999));

  // Recompute adjustments_total from the lines so it can never drift from what is shown.
  const sum = await one<{ total: number }>(env, "SELECT COALESCE(SUM(amount), 0) AS total FROM statement_lines WHERE statement_id = ? AND line_type = 'adjustment'", id);
  const adjustmentsTotal = Number(sum?.total ?? 0);
  const net = Number(st.gross_booking_value) - Number(st.management_fee) - Number(st.expenses_total) + adjustmentsTotal;
  await run(env, 'UPDATE owner_statements SET adjustments_total = ?, net_payout = ? WHERE id = ?', adjustmentsTotal, net, id);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'statement.adjust',
    entityTable: 'owner_statements', entityId: id,
    before: { adjustments_total: Number(st.adjustments_total), net_payout: Number(st.net_payout) },
    after: { adjustments_total: adjustmentsTotal, net_payout: net, label, amount },
  });

  return json({ id, adjustmentsTotal, netPayout: net, state: st.state });
};
