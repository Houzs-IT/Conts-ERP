import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { STAY_SQL } from '../../_lib/reviewStays';
import { BAD_REVIEW_MAX } from '../../../src/lib/reviewRules';

/** GET /api/reviews/units?by=unit|building — the Reviews overview by unit (default) or by building: review count,
 *  average rating, last review date, bad reviews (BAD_REVIEW_MAX stars or fewer), reviews waiting for a reply, and
 *  how many finished stays left a review and how many have not. Every unit with a review or a finished stay is listed,
 *  so a unit whose guests never review shows up too. Sorted on the screen. A review with no unit is in no row. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const byBuilding = new URL(request.url).searchParams.get('by') === 'building';
  const rows = await all<any>(env, `
    WITH rv AS (
      SELECT COALESCE(v.unit_id, r.unit_id) AS unit_id, count(*)::int AS n, sum(v.rating) AS rating_sum, max(v.reviewed_at) AS last_at,
        count(*) FILTER (WHERE v.rating <= ?)::int AS bad, count(*) FILTER (WHERE v.reply IS NULL)::int AS needs_reply
      FROM reviews v LEFT JOIN reservations r ON r.id = v.reservation_id
      GROUP BY 1
    ), st AS (
      SELECT r.unit_id, count(*)::int AS stays,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM reviews v WHERE v.reservation_id = r.id))::int AS reviewed
      FROM reservations r WHERE ${STAY_SQL} AND r.check_out < ?
      GROUP BY 1
    ), per_unit AS (
      SELECT u.id AS unit_id, COALESCE(rv.n, 0) AS n, rv.rating_sum, rv.last_at, COALESCE(rv.bad, 0) AS bad,
        COALESCE(rv.needs_reply, 0) AS needs_reply, COALESCE(st.stays, 0) AS stays, COALESCE(st.reviewed, 0) AS reviewed
      FROM units u LEFT JOIN rv ON rv.unit_id = u.id LEFT JOIN st ON st.unit_id = u.id
    )
    SELECT ${byBuilding
      ? `p.id, NULL AS unit_number, p.id AS property_id, p.name AS property_name, count(*)::int AS units,
         sum(x.n)::int AS n, sum(x.rating_sum) AS rating_sum, max(x.last_at) AS last_at, sum(x.bad)::int AS bad,
         sum(x.needs_reply)::int AS needs_reply, sum(x.stays)::int AS stays, sum(x.reviewed)::int AS reviewed`
      : `u.id, u.unit_number, p.id AS property_id, p.name AS property_name, 1 AS units,
         x.n, x.rating_sum, x.last_at, x.bad, x.needs_reply, x.stays, x.reviewed`}
    FROM per_unit x JOIN units u ON u.id = x.unit_id LEFT JOIN properties p ON p.id = u.property_id
    WHERE x.n > 0 OR x.stays > 0
    ${byBuilding ? 'GROUP BY p.id, p.name' : ''}
    ORDER BY 6 DESC, 4, 2`, BAD_REVIEW_MAX, mytToday());
  return json({
    generatedAt: new Date().toISOString(),
    by: byBuilding ? 'building' : 'unit',
    badMax: BAD_REVIEW_MAX,
    data: rows.map(r => {
      const n = Number(r.n ?? 0), stays = Number(r.stays ?? 0), reviewed = Number(r.reviewed ?? 0);
      return {
        id: r.id ?? 'none', unitId: byBuilding ? null : r.id, unitNumber: r.unit_number ?? null,
        propertyId: r.property_id ?? null, propertyName: r.property_name ?? null, units: Number(r.units ?? 1),
        reviews: n, average: n ? Math.round((Number(r.rating_sum) / n) * 100) / 100 : null,
        lastReviewAt: r.last_at ? String(r.last_at).slice(0, 10) : null, bad: Number(r.bad ?? 0), needsReply: Number(r.needs_reply ?? 0),
        staysCheckedOut: stays, staysReviewed: reviewed, staysWithoutReview: stays - reviewed,
      };
    }),
  });
};
