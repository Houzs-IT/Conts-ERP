import { type Env, one, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const KL_TODAY = `to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;

/** GET /api/dashboard/today — the five counts on the dashboard's "Today" card. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const c = await one<Record<string, number>>(env, `
    WITH d AS (SELECT ${KL_TODAY} AS today)
    SELECT
      (SELECT today FROM d) AS today,
      (SELECT COUNT(*) FROM reservations, d WHERE check_in = d.today AND state IN ('confirmed','checked_in') AND channel NOT IN ('maintenance_block','owner_stay')) AS check_ins,
      (SELECT COUNT(*) FROM reservations, d WHERE check_out = d.today AND state IN ('confirmed','checked_in','checked_out') AND channel NOT IN ('maintenance_block','owner_stay')) AS check_outs,
      (SELECT COUNT(*) FROM tasks, d WHERE state != 'resolved' AND kind IN ('turnover','deep_clean','light_clean') AND substr(COALESCE(due_at, scheduled_for, created_at), 1, 10) <= d.today) AS cleaning_pending,
      (SELECT COUNT(*) FROM maintenance_issues WHERE state != 'resolved') AS maintenance_open,
      (SELECT COUNT(*) FROM message_threads WHERE is_read = 0) AS escalations`);

  const n = (k: string) => Number(c?.[k] ?? 0);
  return json({
    generatedAt: new Date().toISOString(),
    date: String(c?.today),
    rows: [
      { key: 'check_ins', count: n('check_ins'), tone: 'info' },
      { key: 'check_outs', count: n('check_outs'), tone: 'info' },
      { key: 'cleaning_pending', count: n('cleaning_pending'), tone: n('cleaning_pending') ? 'warning' : 'neutral' },
      { key: 'maintenance_open', count: n('maintenance_open'), tone: n('maintenance_open') ? 'warning' : 'neutral' },
      { key: 'escalations', count: n('escalations'), tone: n('escalations') ? 'critical' : 'neutral' },
    ],
  });
};
