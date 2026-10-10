import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { twoFactorTables } from '../../_lib/twoFactor';

const RESULTS = ['success', 'wrong_password', 'locked', '2fa_failed', 'inactive'];
const SIZES = [25, 50, 100];

/**
 * GET /api/users/sign-ins?user=&result=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&pageSize= — management only.
 * Every sign-in attempt, newest first (login_events, migration 0098). Dates are Malaysia days.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can see the sign-in record.', 403);
  if (!(await twoFactorTables(env))) return json({ data: [], total: 0, page: 1, pageSize: 25, notMigrated: true });

  const q = new URL(request.url).searchParams;
  const where: string[] = [];
  const args: unknown[] = [];
  const user = q.get('user');
  if (user) { where.push('e.user_id = ?'); args.push(user); }
  const result = q.get('result');
  if (result) {
    if (!RESULTS.includes(result)) return fail('VALIDATION', 'Unknown result filter.', 422);
    where.push('e.result = ?'); args.push(result);
  }
  // Malaysia is UTC+8 all year; a day there starts at 16:00 UTC the day before.
  const day = (d: string | null, add: number) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(Date.parse(`${d}T00:00:00+08:00`) + add * 864e5).toISOString() : null;
  const from = day(q.get('from'), 0), to = day(q.get('to'), 1);
  if (from) { where.push('e.at >= ?'); args.push(from); }
  if (to) { where.push('e.at < ?'); args.push(to); }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const pageSize = SIZES.includes(Number(q.get('pageSize'))) ? Number(q.get('pageSize')) : 25;
  const page = Math.max(1, Math.floor(Number(q.get('page')) || 1));
  const total = Number((await one<{ n: number }>(env, `SELECT count(*) AS n FROM login_events e ${filter}`, ...args))?.n ?? 0);
  const rows = await all<{ id: string; user_id: string | null; email: string; full_name: string | null; at: string; ip: string | null; user_agent: string | null; result: string; method: string }>(env, `
    SELECT e.id, e.user_id, e.email, u.full_name, e.at, e.ip, e.user_agent, e.result, e.method
    FROM login_events e LEFT JOIN users u ON u.id = e.user_id
    ${filter} ORDER BY e.at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, ...args);

  return json({
    data: rows.map(r => ({ id: r.id, userId: r.user_id, email: r.email, fullName: r.full_name, at: r.at, ip: r.ip, userAgent: r.user_agent, result: r.result, method: r.method })),
    total, page, pageSize,
  }, 200, { 'cache-control': 'no-store' });
};
