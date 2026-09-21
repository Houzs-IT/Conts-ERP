import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/** POST /api/statements/generate { period: "2026-08" }
 *  Builds a provisional statement per owner from settled bookings and documented
 *  expenses. Provisional figures never reach an owner — sending is a separate step. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) {
    return fail('FORBIDDEN', 'You can view statements but cannot generate them. Ask a Finance Admin for access.', 403);
  }

  const { period } = await request.json<{ period: string }>();
  if (!/^\d{4}-\d{2}$/.test(period ?? '')) return fail('VALIDATION', 'Period must look like 2026-08.', 422);

  const start = `${period}-01`;
  const end = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).toISOString().slice(0, 10);

  const locked = await one<{ n: number }>(env,
    "SELECT COUNT(*) AS n FROM owner_statements WHERE period_start = ? AND state IN ('sent','paid')", start);
  if (locked && locked.n > 0) {
    return fail('PERIOD_LOCKED', 'Statements for this period have already been sent and cannot be regenerated.', 409);
  }

  const owners = await all<any>(env, `
    SELECT o.id, o.display_name, COALESCE(MAX(c.management_fee_pct), 25) AS fee_pct
    FROM owners o
    LEFT JOIN owner_contracts c ON c.owner_id = o.id
    GROUP BY o.id`);

  let count = 0;
  for (const o of owners) {
    const rev = await one<{ gross: number }>(env, `
      SELECT COALESCE(SUM(r.collected_revenue), 0) AS gross
      FROM reservations r JOIN units u ON u.id = r.unit_id
      WHERE u.owner_id = ? AND r.state IN ('confirmed','checked_in','checked_out')
        AND r.channel NOT IN ('maintenance_block','owner_stay')
        AND r.check_in BETWEEN ? AND ?`, o.id, start, end);

    const exp = await one<{ total: number }>(env, `
      SELECT COALESCE(SUM(e.amount), 0) AS total
      FROM expenses e JOIN units u ON u.id = e.unit_id
      WHERE u.owner_id = ? AND e.charge_to = 'owner' AND e.incurred_on BETWEEN ? AND ?`,
      o.id, start, end);

    const gross = rev?.gross ?? 0;
    if (gross === 0 && (exp?.total ?? 0) === 0) continue;

    // Integer sen throughout. Round the fee once, at the end.
    const fee = Math.round(gross * (o.fee_pct / 100));
    const expenses = exp?.total ?? 0;
    const net = gross - fee - expenses;

    const id = crypto.randomUUID();
    await run(env, `
      INSERT INTO owner_statements
        (id, owner_id, period_start, period_end, state, gross_booking_value, management_fee, expenses_total, net_payout, currency, generated_at, created_at)
      VALUES (?, ?, ?, ?, 'provisional', ?, ?, ?, ?, 'MYR', ?, ?)
      ON CONFLICT (owner_id, period_start, period_end) DO UPDATE SET
        gross_booking_value = excluded.gross_booking_value,
        management_fee = excluded.management_fee,
        expenses_total = excluded.expenses_total,
        net_payout = excluded.net_payout,
        generated_at = excluded.generated_at`,
      id, o.id, start, end, gross, fee, expenses, net, nowIso(), nowIso());
    count++;
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'statement.generate',
    entityTable: 'owner_statements', entityId: period, after: { period, count },
  });

  return json({ period, count }, 202);
};
