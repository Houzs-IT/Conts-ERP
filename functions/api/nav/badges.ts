import { type Env, one, json } from '../../_lib/db';
import { requireSession, isFieldRole, canSeeFinance } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';

/** GET /api/nav/badges — live counts for the side menu: open work up to today, open maintenance,
 *  unread inbox threads, and statements still provisional (finance roles only). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return json({ today: 0, maintenance: 0, inbox: 0, statements: 0 });

  const c = await one<{ today: number; maintenance: number; inbox: number; statements: number }>(env, `
    SELECT
      (SELECT count(*)::int FROM tasks WHERE state != 'resolved'
         AND ${MYT_DATE('COALESCE(scheduled_for, due_at, created_at)')} <= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')) AS today,
      (SELECT count(*)::int FROM maintenance_issues WHERE state != 'resolved') AS maintenance,
      (SELECT count(*)::int FROM message_threads WHERE is_read = 0) AS inbox,
      (SELECT count(*)::int FROM owner_statements WHERE state = 'provisional') AS statements`);
  // Today lists open maintenance alongside the day's tasks (operations/today.ts), so its count does too.
  return json({ ...c!, today: c!.today + c!.maintenance, statements: canSeeFinance(session.role) ? c!.statements : 0 });
};
