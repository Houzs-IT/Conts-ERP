import { type Env, all, json, fail, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** GET /api/owners/:id/statements — that owner's statement history, newest first. hasUnits: built by the workbook
 *  rules, so it has unit figures and an Owner Income Report (months paid before Property OS carry only the payout). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Statements are visible to finance and management roles.', 403);

  const rows = await all<any>(env, `
    SELECT s.id, s.period_start, s.state, s.gross_booking_value, s.net_payout,
           EXISTS (SELECT 1 FROM statement_units su WHERE su.statement_id = s.id) AS has_units
    FROM owner_statements s WHERE s.owner_id = ? ORDER BY s.period_start DESC LIMIT 24`, String(params.id));
  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({ id: r.id, period: String(r.period_start).slice(0, 7), grossBookingValue: Number(r.gross_booking_value), netPayout: Number(r.net_payout), state: r.state, hasUnits: !!r.has_units })),
  });
};
