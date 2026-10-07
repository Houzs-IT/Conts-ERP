import { type Env, one, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';

/** GET /api/nav/badges — live counts for the side menu: open work up to today, open maintenance,
 *  unread inbox threads, statements still provisional (finance roles only), and the channel sync state. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return json({ today: 0, maintenance: 0, inbox: 0, statements: 0, channels: { units: 0, lastSentAt: null, failed: 0 } });

  const c = await one<{ today: number; maintenance: number; inbox: number; statements: number }>(env, `
    SELECT
      (SELECT count(*)::int FROM tasks WHERE state != 'resolved'
         AND ${MYT_DATE('COALESCE(scheduled_for, due_at, created_at)')} <= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')) AS today,
      (SELECT count(*)::int FROM maintenance_issues WHERE state != 'resolved') AS maintenance,
      (SELECT count(*)::int FROM message_threads WHERE is_read = 0) AS inbox,
      (SELECT count(*)::int FROM owner_statements WHERE state = 'provisional') AS statements`);
  // The header's channel chip: units really connected to a booking site, when the last update was accepted,
  // and how many updates Channex refused.
  const ch = await one<{ units: number; last_sent: string | null; failed: number }>(env, `
    SELECT (SELECT count(DISTINCT unit_id)::int FROM channex_channels) AS units,
           (SELECT max(called_at) FROM channex_calls WHERE status BETWEEN 200 AND 299) AS last_sent,
           (SELECT count(*)::int FROM channex_outbox o WHERE o.status = 'failed' AND o.unit_id IN (SELECT unit_id FROM channex_channels)) AS failed`);
  const channels = { units: ch?.units ?? 0, lastSentAt: ch?.last_sent ?? null, failed: ch?.failed ?? 0 };
  // Today lists open maintenance alongside the day's tasks (operations/today.ts), so its count does too.
  return json({ channels, ...c!, today: c!.today + c!.maintenance, statements: session.manage ? c!.statements : 0 });
};
