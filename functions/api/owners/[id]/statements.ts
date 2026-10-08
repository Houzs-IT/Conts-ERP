import { type Env, all, json, fail, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** GET /api/owners/:id/statements — that owner's statement history, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Statements are visible to finance and management roles.', 403);

  const rows = await all<any>(env, `
    SELECT id, period_start, state, gross_booking_value, net_payout FROM owner_statements WHERE owner_id = ? ORDER BY period_start DESC LIMIT 24`, String(params.id));
  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({ id: r.id, period: String(r.period_start).slice(0, 7), grossBookingValue: Number(r.gross_booking_value), netPayout: Number(r.net_payout), state: r.state })),
  });
};
