import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

/** GET /api/reviews — guest reviews across every channel, with the host's reply where there is one.
 *    ?page=1&pageSize=50       newest first
 *    &rating=1..5              one star rating
 *    &reply=needs_reply|replied
 *  `summary` and `average` are over every review, whatever the filters, so the header does not change with them. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const url = new URL(request.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 50)));
  const rating = Math.floor(Number(url.searchParams.get('rating')));
  const reply = url.searchParams.get('reply');

  const where: string[] = [], args: unknown[] = [];
  if (rating >= 1 && rating <= 5) { where.push('v.rating = ?'); args.push(rating); }
  if (reply === 'needs_reply') where.push('v.reply IS NULL');
  else if (reply === 'replied') where.push('v.reply IS NOT NULL');
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, filtered, sum] = await Promise.all([
    all<any>(env, `
      SELECT v.*, u.unit_number, p.name AS property_name, COALESCE(g.full_name, 'Guest') AS guest_name
      FROM reviews v
      JOIN units u ON u.id = v.unit_id
      JOIN properties p ON p.id = u.property_id
      LEFT JOIN reservations r ON r.id = v.reservation_id
      LEFT JOIN guests g ON g.id = r.guest_id
      ${cond}
      ORDER BY v.reviewed_at DESC, v.id DESC
      LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize),
    one<{ n: number }>(env, `SELECT count(*)::int AS n FROM reviews v JOIN units u ON u.id = v.unit_id ${cond}`, ...args),
    one<{ n: number; replied: number; a: number | null }>(env, `
      SELECT count(*)::int AS n, count(*) FILTER (WHERE v.reply IS NOT NULL)::int AS replied, ROUND(AVG(v.rating)::numeric, 2) AS a
      FROM reviews v JOIN units u ON u.id = v.unit_id`),
  ]);
  const avg = sum?.a;

  return json({
    generatedAt: new Date().toISOString(),
    average: avg === null || avg === undefined ? null : Number(avg),
    summary: { total: sum?.n ?? 0, replied: sum?.replied ?? 0 },
    page, pageSize, total: filtered?.n ?? 0,
    data: rows.map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name, guestName: r.guest_name,
      channel: r.channel, rating: Number(r.rating), comment: r.comment, reviewedAt: String(r.reviewed_at).slice(0, 10),
      reply: r.reply ?? null, repliedAt: r.replied_at ? String(r.replied_at).slice(0, 10) : null,
    })),
  });
};
