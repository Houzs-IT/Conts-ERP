import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const STATES = ['provisional', 'finalised', 'sent', 'paid'];

/** GET /api/statements?period=YYYY-MM&state=&q=&page=&pageSize=
 *  One period's statements (default: the latest period that has any), with that period's totals and a
 *  per-period summary for the period menu. Owners see only their own. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const ownerScoped = session.role === 'owner';
  if (!session.manage && !ownerScoped) {
    return fail('FORBIDDEN', 'Statements are visible to finance and management roles.', 403);
  }

  const url = new URL(request.url);
  let period = url.searchParams.get('period');
  const state = url.searchParams.get('state');
  const q = url.searchParams.get('q')?.trim() || null;
  if (period && period !== 'all' && !/^\d{4}-\d{2}$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);
  if (state && !STATES.includes(state)) return fail('VALIDATION', 'Unknown statement state.', 422);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 200)));

  const scope = ownerScoped ? 'AND o.user_id = ?' : '';
  const scopeArgs = ownerScoped ? [session.userId] : [];

  const periods = await all<any>(env, `
    SELECT substr(s.period_start, 1, 7) AS period, COUNT(*) AS n,
           COUNT(*) FILTER (WHERE s.state = 'provisional') AS provisional, COUNT(*) FILTER (WHERE s.state = 'finalised') AS finalised,
           COUNT(*) FILTER (WHERE s.state = 'sent') AS sent, COUNT(*) FILTER (WHERE s.state = 'paid') AS paid,
           COALESCE(SUM(s.net_payout), 0) AS net
    FROM owner_statements s JOIN owners o ON o.id = s.owner_id WHERE 1 = 1 ${scope}
    GROUP BY 1 ORDER BY 1 DESC`, ...scopeArgs);
  if (!period) period = periods[0]?.period ?? null;
  const onePeriod = period && period !== 'all' ? period : null;

  const where: string[] = [], args: unknown[] = [];
  if (onePeriod) { where.push('s.period_start = ?'); args.push(`${onePeriod}-01`); }
  if (state) { where.push('s.state = ?'); args.push(state); }
  if (q) {
    where.push(`(o.display_name ILIKE ? OR EXISTS (SELECT 1 FROM units u JOIN properties p ON p.id = u.property_id WHERE u.owner_id = s.owner_id AND (p.name || ' ' || u.unit_number) ILIKE ?))`);
    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    args.push(like, like);
  }
  if (ownerScoped) { where.push('o.user_id = ?'); args.push(session.userId); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [rows, totals] = await Promise.all([
    all<any>(env, `
      SELECT s.*, o.display_name,
             (SELECT string_agg(p.name || ' ' || u.unit_number, ', ' ORDER BY p.name, u.unit_number)
              FROM units u JOIN properties p ON p.id = u.property_id
              WHERE u.owner_id = s.owner_id) AS units_label
      FROM owner_statements s
      JOIN owners o ON o.id = s.owner_id
      ${whereSql}
      ORDER BY s.period_start DESC, o.display_name
      LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize),
    all<any>(env, `
      SELECT COUNT(*) AS n, COALESCE(SUM(s.gross_booking_value), 0) AS gross, COALESCE(SUM(s.management_fee), 0) AS fee,
             COALESCE(SUM(s.expenses_total), 0) AS expenses, COALESCE(SUM(s.net_payout), 0) AS net,
             COUNT(*) FILTER (WHERE s.state = 'finalised') AS not_sent
      FROM owner_statements s JOIN owners o ON o.id = s.owner_id ${whereSql}`, ...args),
  ]);
  const t = totals[0] ?? {};

  // filtersApplied and generatedAt are mandatory — exports must print them.
  return json({
    generatedAt: new Date().toISOString(),
    period: period ?? null,
    filtersApplied: { period: period ?? 'all', state: state ?? 'all', q: q ?? '' },
    page, pageSize, total: Number(t.n ?? 0),
    totals: { gross: Number(t.gross ?? 0), fee: Number(t.fee ?? 0), expenses: Number(t.expenses ?? 0), net: Number(t.net ?? 0) },
    summary: { notSent: Number(t.not_sent ?? 0) },
    periods: periods.map(p => ({
      period: p.period, count: Number(p.n), net: Number(p.net),
      provisional: Number(p.provisional), finalised: Number(p.finalised), sent: Number(p.sent), paid: Number(p.paid),
    })),
    data: rows.map(r => ({
      id: r.id, period: String(r.period_start).slice(0, 7), ownerName: r.display_name, unitsLabel: r.units_label,
      periodStart: r.period_start, periodEnd: r.period_end, state: r.state,
      grossBookingValue: r.gross_booking_value, managementFee: r.management_fee,
      expensesTotal: r.expenses_total, netPayout: r.net_payout, currency: r.currency,
      sentAt: r.sent_at, finalisedAt: r.finalised_at, source: r.source ?? 'generated',
    })),
  });
};
