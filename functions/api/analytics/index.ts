import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/** GET /api/analytics?months=6
 *  Occupancy, ADR and RevPAR use the brand guide's definitions:
 *    occupancy = occupied available nights / available nights
 *    ADR       = accommodation revenue / occupied nights
 *    RevPAR    = accommodation revenue / available nights
 *  Maintenance blocks and owner stays are excluded from available nights. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) {
    return fail('FORBIDDEN', 'Analytics are visible to finance and management roles.', 403);
  }

  const months = Math.min(Number(new URL(request.url).searchParams.get('months') ?? 6), 24);

  const series = await all<any>(env, `
    SELECT substr(r.check_in, 1, 7) AS period,
           COALESCE(SUM(r.collected_revenue), 0) AS revenue,
           COALESCE(SUM(r.check_out::date - r.check_in::date), 0) AS nights
    FROM reservations r
    WHERE r.state IN ('confirmed','checked_in','checked_out')
      AND r.channel NOT IN ('maintenance_block','owner_stay')
      AND r.check_in >= to_char(now() + ?::interval, 'YYYY-MM-DD')
    GROUP BY period ORDER BY period`, `-${months} months`);

  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.readiness, p.name AS property_name, o.display_name AS owner_name,
           COALESCE(SUM(r.collected_revenue), 0) AS revenue,
           COALESCE(SUM(r.check_out::date - r.check_in::date), 0) AS nights,
           (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews v WHERE v.unit_id = u.id) AS rating
    FROM units u
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    LEFT JOIN reservations r ON r.unit_id = u.id
      AND r.state IN ('confirmed','checked_in','checked_out')
      AND r.channel NOT IN ('maintenance_block','owner_stay')
      AND r.check_in >= to_char(now() - interval '1 month', 'YYYY-MM-DD')
    WHERE u.is_listed = 1
    GROUP BY u.id, p.name, o.display_name`);

  const DAYS = 30;
  const perUnit = units.map(u => ({
    unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name,
    ownerName: u.owner_name, readiness: u.readiness,
    revenue: u.revenue,
    occupancy: Number(((u.nights / DAYS) * 100).toFixed(1)),
    adr: u.nights > 0 ? Math.round(u.revenue / u.nights) : 0,
    revpar: Math.round(u.revenue / DAYS),
    rating: u.rating,
  }));

  return json({
    generatedAt: new Date().toISOString(),
    currency: 'MYR',
    series: series.map(s => ({
      period: s.period,
      revenue: s.revenue,
      nights: Math.round(s.nights),
      adr: s.nights > 0 ? Math.round(s.revenue / s.nights) : 0,
    })),
    units: perUnit,
    best: [...perUnit].sort((a, b) => b.occupancy - a.occupancy).slice(0, 3),
    weakest: [...perUnit].sort((a, b) => a.occupancy - b.occupancy).slice(0, 3),
  });
};
