import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { stayMonths, metrics, groupBy } from '../../_lib/revenue';

/** GET /api/portfolio/performance?period=2026-09 (a month) or ?period=2026-q3 (a quarter, to
 *  today if the quarter isn't over yet) — one row per listed unit. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const nowRow = await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`);
  const today = nowRow!.d;
  const periodParam = new URL(request.url).searchParams.get('period') ?? today.slice(0, 7);
  const finance = session.manage;

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
           (SELECT ROUND(AVG(v.rating)::numeric, 2) FROM reviews v WHERE v.unit_id = u.id) AS rating,
           (SELECT COUNT(*) FROM maintenance_issues mi WHERE mi.unit_id = u.id AND mi.state != 'resolved') AS open_issues
    FROM units u
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    WHERE u.is_listed = 1
    ORDER BY p.name, u.unit_number`);
  // functions/_lib/revenue.ts: gross value and nights split by night into the window (a quarter to date stops today).
  const byUnit = groupBy(await stayMonths(env, dateFrom, dateToExclusive, { listedOnly: true }), r => r.unit_id);

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
      const m = metrics(byUnit.get(r.id) ?? [], days);
      return {
        unitId: r.id, unitNumber: r.unit_number, propertyName: r.property_name, ownerName: r.owner_name,
        occupancy: m.occupancy,
        adr: finance ? m.adr : 0,
        revpar: finance ? m.revpar : 0,
        revenue: finance ? m.gross : 0,
        rating: r.rating === null ? null : Number(r.rating),
        exception: exception(r),
      };
    }),
  });
};
