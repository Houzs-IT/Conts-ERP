import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'operations_staff') {
    return fail('FORBIDDEN', 'Owner records are visible to operations and finance roles.', 403);
  }

  const month = new Date().toISOString().slice(0, 7);
  const rows = await all<any>(env, `
    SELECT o.id, o.display_name, o.email,
           COUNT(DISTINCT u.id) AS unit_count,
           COALESCE(MAX(c.management_fee_pct), 25) AS fee_pct,
           MAX(c.renews_on) AS renews_on,
           string_agg(DISTINCT p.name || ' ' || u.unit_number, ',') AS units_label,
           COALESCE((
             SELECT SUM(r.collected_revenue) FROM reservations r
             JOIN units u2 ON u2.id = r.unit_id
             WHERE u2.owner_id = o.id
               AND r.state IN ('confirmed','checked_in','checked_out')
               AND r.channel NOT IN ('maintenance_block','owner_stay')
               AND substr(r.check_in, 1, 7) = ?
           ), 0) AS month_revenue
    FROM owners o
    LEFT JOIN units u ON u.owner_id = o.id
    LEFT JOIN properties p ON p.id = u.property_id
    LEFT JOIN owner_contracts c ON c.owner_id = o.id
    GROUP BY o.id
    ORDER BY o.display_name`, month);

  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map(r => ({
      id: r.id, displayName: r.display_name, email: r.email,
      unitsLabel: r.units_label ?? '\u2014', unitCount: r.unit_count,
      managementFeePct: r.fee_pct, monthRevenue: r.month_revenue, renewsOn: r.renews_on,
      // Bank details are never in a list response.
    })),
  });
};
