import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/** GET /api/portfolio/performance?period=2026-09 (a month) or ?period=2026-q3 (a quarter, to
 *  today if the quarter isn't over yet) — one row per listed unit. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const nowRow = await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`);
  const today = nowRow!.d;
  const periodParam = new URL(request.url).searchParams.get('period') ?? today.slice(0, 7);
  const finance = canSeeFinance(session.role);

  const quarter = periodParam.match(/^(\d{4})-q([1-4])$/i);
  const month = periodParam.match(/^(\d{4})-(\d{2})$/);

  let dateFrom: string, dateToExclusive: string, days: number, period: string;
  if (quarter) {
    const y = Number(quarter[1]), q = Number(quarter[2]);
    const startMonth = (q - 1) * 3 + 1; // 1, 4, 7 or 10
    dateFrom = `${y}-${String(startMonth).padStart(2, '0')}-01`;
    const quarterEndExclusive = new Date(Date.UTC(y, startMonth + 2, 1)).toISOString().slice(0, 10); // first day after the quarter
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
    dateToExclusive = tomorrow < quarterEndExclusive ? tomorrow : quarterEndExclusive; // "to date": stop at today unless the quarter has already ended
    days = Math.max(1, Math.round((Date.parse(dateToExclusive) - Date.parse(dateFrom)) / 864e5));
    period = `${y}-q${q}`;
  } else if (month) {
    const y = Number(month[1]), m = Number(month[2]);
    dateFrom = `${y}-${month[2]}-01`;
    dateToExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    period = `${y}-${month[2]}`;
  } else {
    return fail('VALIDATION', 'Unknown period.', 422);
  }

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
      AND r.check_in >= ? AND r.check_in < ?
    WHERE u.is_listed = 1
    GROUP BY u.id, p.id, p.name, o.display_name
    ORDER BY p.name, u.unit_number`, dateFrom, dateToExclusive);

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
