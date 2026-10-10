import { type Env, all, one, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { unitCode } from '../../../_lib/ownerReport';

/** GET /api/statements/:id — one statement with everything behind it: its units (nights, income, deductions,
 *  split, guarantee, adjustments, payout), every line with the booking, expense or adjustment it came from,
 *  the payout once sent, and what finance should check before finalising. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);

  const s = await one<any>(env, `
    SELECT s.*, o.display_name, o.legal_name, o.email, o.phone, o.user_id AS owner_user, o.bank_name, o.bank_account_last4
    FROM owner_statements s JOIN owners o ON o.id = s.owner_id WHERE s.id = ?`, id);
  if (!s) return fail('NOT_FOUND', 'That statement no longer exists.', 404);
  if (session.role === 'owner') {
    if (s.owner_user !== session.userId) return fail('FORBIDDEN', 'This statement belongs to another owner.', 403);
    if (s.state === 'provisional') return fail('NOT_FINAL', 'This statement is not final yet.', 403);
  } else if (!session.manage) return fail('FORBIDDEN', 'Statements are visible to finance and management roles.', 403);

  const [units, lines, payout] = await Promise.all([
    all<any>(env, `
      SELECT su.*, u.unit_number, u.package, p.name AS property_name FROM statement_units su JOIN units u ON u.id = su.unit_id JOIN properties p ON p.id = u.property_id
      WHERE su.statement_id = ? ORDER BY p.name, u.unit_number`, id),
    all<any>(env, `
      SELECT l.*, u.unit_number, p.name AS property_name, r.check_in, r.check_out, r.channel, r.external_ref
      FROM statement_lines l LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN properties p ON p.id = u.property_id LEFT JOIN reservations r ON r.id = l.reservation_id
      WHERE l.statement_id = ? ORDER BY l.sort_order, l.occurred_on`, id),
    one<any>(env, 'SELECT id, state, amount, paid_at, failure_reason FROM payouts WHERE statement_id = ? ORDER BY created_at DESC LIMIT 1', id),
  ]);

  return json({
    generatedAt: new Date().toISOString(),
    data: {
      id: s.id, period: String(s.period_start).slice(0, 7), periodStart: s.period_start, periodEnd: s.period_end, state: s.state, source: s.source ?? 'generated',
      generatedAt: s.generated_at, finalisedAt: s.finalised_at, sentAt: s.sent_at,
      owner: { id: s.owner_id, name: s.display_name, legalName: s.legal_name, email: s.email, phone: s.phone, bankName: s.bank_name, bankLast4: s.bank_account_last4 },
      totals: { grossIncome: s.gross_booking_value, operatorShare: s.management_fee, deductions: s.expenses_total, adjustments: s.adjustments_total, netPayout: s.net_payout },
      payout: payout ? { id: payout.id, state: payout.state, amount: payout.amount, paidAt: payout.paid_at, failureReason: payout.failure_reason } : null,
      units: units.map(u => ({
        unitId: u.unit_id, label: `${u.property_name} ${u.unit_number}`, code: unitCode(u.property_name, u.unit_number), package: u.package,
        basis: u.basis, termsSource: u.terms_source, nights: u.nights, days: u.days, grossIncome: u.gross_income, deductions: u.deductions, netIncome: u.net_income,
        ownerPct: u.owner_pct === null ? null : Number(u.owner_pct), operatorShare: u.operator_share, guarantee: u.guarantee, topUp: u.top_up, fixedRent: u.fixed_rent,
        payoutBeforeAdjustments: u.payout_before_adjustments, adjustments: u.adjustments_total, netPayout: u.net_payout,
        warnings: u.notes ? (JSON.parse(u.notes) as string[]) : [],
      })),
      lines: lines.map(l => ({
        id: l.id, unitId: l.unit_id, unitLabel: l.property_name ? `${l.property_name} ${l.unit_number}` : null, type: l.line_type, category: l.category,
        description: l.description, occurredOn: l.occurred_on, amount: l.amount, quantity: l.quantity === null ? null : Number(l.quantity), reference: l.reference,
        reservationId: l.reservation_id, expenseId: l.expense_id, adjustmentId: l.adjustment_id,
        booking: l.reservation_id ? { checkIn: l.check_in, checkOut: l.check_out, channel: l.channel, ref: l.external_ref } : null,
      })),
    },
  });
};
