import { type Env, all, one, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const ownerScoped = session.role === 'owner';
  const rows = await all<any>(env, `
    SELECT v.*, u.unit_number, p.name AS property_name, COALESCE(g.full_name,'Guest') AS guest_name
    FROM reviews v
    JOIN units u ON u.id = v.unit_id
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    LEFT JOIN reservations r ON r.id = v.reservation_id
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE 1 = 1 ${ownerScoped ? 'AND o.user_id = ?' : ''}
    ORDER BY v.reviewed_at DESC`, ...(ownerScoped ? [session.userId] : []));

  const avg = await one<{ a: number }>(env, 'SELECT ROUND(AVG(rating)::numeric, 2) AS a FROM reviews');

  return json({
    generatedAt: new Date().toISOString(),
    average: avg?.a ?? null,
    data: rows.map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      // Owners see a first name and last initial only, never full guest identity.
      guestName: ownerScoped
        ? r.guest_name.split(' ')[0] + ' ' + (r.guest_name.split(' ')[1]?.[0] ?? '') + '.'
        : r.guest_name,
      channel: r.channel, rating: r.rating, comment: r.comment, reviewedAt: r.reviewed_at,
    })),
  });
};
