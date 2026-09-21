import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

/** GET /api/reviews — guest reviews across every channel, with the host's reply where there is one. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);

  const rows = await all<any>(env, `
    SELECT v.*, u.unit_number, p.name AS property_name, COALESCE(g.full_name, 'Guest') AS guest_name
    FROM reviews v
    JOIN units u ON u.id = v.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN reservations r ON r.id = v.reservation_id
    LEFT JOIN guests g ON g.id = r.guest_id
    ORDER BY v.reviewed_at DESC LIMIT 500`);
  const avg = await one<{ a: number }>(env, 'SELECT ROUND(AVG(rating)::numeric, 2) AS a FROM reviews');

  return json({
    generatedAt: new Date().toISOString(),
    average: avg?.a === null || avg?.a === undefined ? null : Number(avg.a),
    data: rows.map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name, guestName: r.guest_name,
      channel: r.channel, rating: Number(r.rating), comment: r.comment, reviewedAt: String(r.reviewed_at).slice(0, 10),
      reply: r.reply ?? null, repliedAt: r.replied_at ? String(r.replied_at).slice(0, 10) : null,
    })),
  });
};
