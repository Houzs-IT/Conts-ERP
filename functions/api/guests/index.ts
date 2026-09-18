import { type Env, all, one, json } from '../../_lib/db';
import { requireSession, isFieldRole, fail } from '../../_lib/auth';

/** Guests are derived from stays — a guest with no reservation has no record. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) {
    return fail('FORBIDDEN', 'Guest contact details are not available to field roles.', 403);
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 25), 100);

  const args: unknown[] = [];
  if (q) { args.push(`%${q}%`, `%${q}%`); }
  args.push(pageSize, (page - 1) * pageSize);

  const rows = await all<any>(env, `
    SELECT g.id, g.full_name, g.email, g.phone, g.country_code,
           COUNT(r.id) AS stays,
           MAX(r.check_out) AS last_stay,
           (SELECT u.unit_number FROM reservations r2 JOIN units u ON u.id = r2.unit_id
            WHERE r2.guest_id = g.id ORDER BY r2.check_in DESC LIMIT 1) AS last_unit,
           (SELECT r3.channel FROM reservations r3 WHERE r3.guest_id = g.id ORDER BY r3.check_in DESC LIMIT 1) AS last_channel
    FROM guests g
    LEFT JOIN reservations r ON r.guest_id = g.id
    WHERE 1 = 1 ${q ? 'AND (g.full_name LIKE ? OR g.email LIKE ?)' : ''}
    GROUP BY g.id
    ORDER BY last_stay DESC
    LIMIT ? OFFSET ?`, ...args);

  const total = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM guests');

  return json({
    generatedAt: new Date().toISOString(),
    page, pageSize, total: total?.n ?? 0,
    data: rows.map(r => ({
      id: r.id, fullName: r.full_name, email: r.email, phone: r.phone,
      countryCode: r.country_code, stays: r.stays,
      lastStay: r.last_stay, lastUnit: r.last_unit, lastChannel: r.last_channel,
    })),
  });
};
