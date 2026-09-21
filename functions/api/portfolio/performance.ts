import { type Env, all, one, json } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/** GET /api/portfolio/performance?period=2026-09 — one row per listed unit. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const now = await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`);
  const period = new URL(request.url).searchParams.get('period') ?? now!.d.slice(0, 7);
  const [y, m] = period.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const finance = canSeeFinance(session.role);

  const rows = await all<any>(env, `
    SELECT u.id, u.unit_number, u.readiness, p.id AS property_id, p.name AS property_name, o.display_name AS owner_name,
           COALESCE(SUM(r.collected_revenue), 0) AS revenue,
           COALESCE(SUM(r.check_out::date - r.check_in::date), 0) AS nights,
           (SELECT ROUND(AVG(v.rating)::numeric, 2) FROM reviews v WHERE v.unit_id = u.id) AS rating,
           (SELECT COUNT(*) FROM maintenance_issues mi WHERE mi.unit_id = u.id AND mi.state != 'resolved') AS open_issues
    FROM units u
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    LEFT JOIN reservations r ON r.unit_id = u.id
      AND r.state IN ('confirmed','checked_in','checked_out')
      AND r.channel NOT IN ('maintenance_block','owner_stay')
      AND substr(r.check_in, 1, 7) = ?
    WHERE u.is_listed = 1
    GROUP BY u.id, p.id, p.name, o.display_name
    ORDER BY p.name, u.unit_number`, period);

  const exception = (r: any) =>
    r.readiness === 'maintenance' || r.readiness === 'blocked' ? { label: 'Off sale', tone: 'warning' }
    : r.readiness === 'dirty' ? { label: 'Needs cleaning', tone: 'warning' }
    : Number(r.open_issues) > 0 ? { label: `${r.open_issues} open issue${Number(r.open_issues) === 1 ? '' : 's'}`, tone: 'info' }
    : null;

  return json({
    generatedAt: new Date().toISOString(),
    period,
    units: rows.length,
    buildings: new Set(rows.map(r => r.property_id)).size,
    rows: rows.map(r => {
      const revenue = Number(r.revenue), nights = Number(r.nights);
      return {
        unitId: r.id, unitNumber: r.unit_number, propertyName: r.property_name, ownerName: r.owner_name,
        occupancy: Math.min(100, Number(((nights / days) * 100).toFixed(1))),
        adr: finance && nights ? Math.round(revenue / nights) : 0,
        revpar: finance ? Math.round(revenue / days) : 0,
        revenue: finance ? revenue : 0,
        rating: r.rating === null ? null : Number(r.rating),
        exception: exception(r),
      };
    }),
  });
};
