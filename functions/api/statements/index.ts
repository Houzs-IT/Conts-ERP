import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const ownerScoped = session.role === 'owner';
  if (!canSeeFinance(session.role) && !ownerScoped) {
    return fail('FORBIDDEN', 'Statements are visible to finance and management roles.', 403);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period');
  const state = url.searchParams.get('state');
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 25), 100);

  const args: unknown[] = [];
  if (period) args.push(`${period}-01`);
  if (state) args.push(state);
  if (ownerScoped) args.push(session.userId);
  args.push(pageSize, (page - 1) * pageSize);

  const rows = await all<any>(env, `
    SELECT s.*, o.display_name,
           (SELECT string_agg(p.name || ' ' || u.unit_number, ', ')
            FROM units u JOIN properties p ON p.id = u.property_id
            WHERE u.owner_id = s.owner_id) AS units_label
    FROM owner_statements s
    JOIN owners o ON o.id = s.owner_id
    WHERE 1 = 1
      ${period ? 'AND s.period_start = ?' : ''}
      ${state ? 'AND s.state = ?' : ''}
      ${ownerScoped ? 'AND o.user_id = ?' : ''}
    ORDER BY s.period_start DESC, o.display_name
    LIMIT ? OFFSET ?`, ...args);

  const total = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owner_statements');
  const notSent = await one<{ n: number }>(env,
    "SELECT COUNT(*) AS n FROM owner_statements WHERE state = 'finalised'");

  // filtersApplied and generatedAt are mandatory — exports must print them.
  return json({
    generatedAt: new Date().toISOString(),
    filtersApplied: { period: period ?? 'all', state: state ?? 'all' },
    page, pageSize, total: total?.n ?? 0,
    summary: { notSent: notSent?.n ?? 0 },
    data: rows.map(r => ({
      id: r.id, ownerName: r.display_name, unitsLabel: r.units_label,
      periodStart: r.period_start, periodEnd: r.period_end, state: r.state,
      grossBookingValue: r.gross_booking_value, managementFee: r.management_fee,
      expensesTotal: r.expenses_total, netPayout: r.net_payout, currency: r.currency,
      sentAt: r.sent_at, finalisedAt: r.finalised_at,
    })),
  });
};
