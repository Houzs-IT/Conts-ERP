import { type Env, one, json, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';
import { waitingCount, approvalsEnabled } from '../../_lib/approvals';
import { levelsFor } from '../../_lib/access';
import { MASTER_ROLES } from '../../_lib/properties';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-MY')} ${n === 1 ? one : many}`;

/** GET /api/nav/badges — live counts for the side menu: open work up to today, open maintenance, unread inbox
 *  threads, statements finalised but not sent (finance roles only), the channel sync state, and `alerts`: the
 *  same live events as a short list for the bell, each with where to go. One request feeds the whole shell. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return json({ today: 0, maintenance: 0, inbox: 0, statements: 0, channels: { units: 0, lastSentAt: null, failed: 0 }, alerts: [] });

  const c = await one<{ today: number; overdue: number; maintenance: number; inbox: number; statements: number; payouts_failed: number; payouts_pending: number; mail_failed: number }>(env, `
    SELECT
      (SELECT count(*)::int FROM tasks WHERE state != 'resolved'
         AND ${MYT_DATE('COALESCE(scheduled_for, due_at, created_at)')} <= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')) AS today,
      (SELECT count(*)::int FROM tasks WHERE state != 'resolved' AND (state = 'overdue' OR (due_at IS NOT NULL AND due_at < ?))) AS overdue,
      (SELECT count(*)::int FROM maintenance_issues WHERE state != 'resolved') AS maintenance,
      (SELECT count(*)::int FROM message_threads WHERE is_read = 0) AS inbox,
      (SELECT count(*)::int FROM owner_statements WHERE state = 'finalised') AS statements,
      (SELECT count(*)::int FROM payouts WHERE state = 'failed') AS payouts_failed,
      (SELECT count(*)::int FROM payouts WHERE state = 'pending') AS payouts_pending,
      (SELECT count(*)::int FROM notification_log WHERE state = 'failed' AND queued_at >= ?) AS mail_failed`, nowIso(), new Date(Date.now() - 7 * 864e5).toISOString());
  // The header's channel chip: units really connected to a booking site, when the last update was accepted,
  // and how many updates Channex refused.
  const ch = await one<{ units: number; last_sent: string | null; failed: number }>(env, `
    SELECT (SELECT count(DISTINCT unit_id)::int FROM channex_channels) AS units,
           (SELECT max(called_at) FROM channex_calls WHERE status BETWEEN 200 AND 299) AS last_sent,
           (SELECT count(*)::int FROM channex_outbox o WHERE o.status = 'failed' AND o.unit_id IN (SELECT unit_id FROM channex_channels)) AS failed`);
  const channels = { units: ch?.units ?? 0, lastSentAt: ch?.last_sent ?? null, failed: ch?.failed ?? 0 };
  const n = c!;
  const [approvals, approvalsOn] = await Promise.all([waitingCount(env, session), approvalsEnabled(env)]);
  // Each count and alert follows the role's level for the area it points into, so nobody is shown a count of
  // records they cannot open or an alert whose link answers "no access".
  const lv = await levelsFor(env, session.role);
  const sees = (area: string) => session.role === 'management' || lv[area] !== 'none';
  const money = MASTER_ROLES.includes(session.role) && sees('finance');
  const ops = sees('operations'), inbox = sees('comms') ? n.inbox : 0, sync = sees('integrations');

  type Alert = { key: string; title: string; body: string; target: string; tone: 'critical' | 'warning' | 'info'; count: number };
  const alerts: Alert[] = [];
  const add = (cond: boolean, a: Alert) => { if (cond) alerts.push(a); };
  add(approvals > 0, { key: 'approvals', tone: 'warning', count: approvals, title: `${plural(approvals, 'money request')} waiting for your approval`, body: 'Refunds, payout runs, owner credits and charges, large expenses and write-offs.', target: '/finance/approvals' });
  add(ops && n.overdue > 0, { key: 'overdue', tone: 'critical', count: n.overdue, title: `${plural(n.overdue, 'task')} overdue`, body: 'Past the time they were due and not finished.', target: '/operations/today' });
  add(money && n.payouts_failed > 0, { key: 'payouts_failed', tone: 'critical', count: n.payouts_failed, title: `${plural(n.payouts_failed, 'payout')} failed`, body: 'Check the bank details, then retry.', target: '/finance/payouts?state=failed' });
  add(sync && channels.failed > 0, { key: 'channels', tone: 'critical', count: channels.failed, title: 'Channel sync needs attention', body: `${plural(channels.failed, 'update')} refused by Channex.`, target: '/system/integrations' });
  add(money && n.mail_failed > 0, { key: 'mail_failed', tone: 'warning', count: n.mail_failed, title: `${plural(n.mail_failed, 'message')} failed to send this week`, body: 'Emails or WhatsApp messages the provider refused.', target: '/system/health' });
  add(money && n.statements > 0, { key: 'statements', tone: 'warning', count: n.statements, title: `${plural(n.statements, 'statement')} finalised, not sent`, body: 'Owners cannot see them until they are sent.', target: '/finance/statements?state=finalised' });
  add(money && n.payouts_pending > 0, { key: 'payouts_pending', tone: 'info', count: n.payouts_pending, title: `${plural(n.payouts_pending, 'payout')} waiting for a payout run`, body: 'Start a run once the transfers are made at the bank.', target: '/finance/payouts?state=pending' });
  add(inbox > 0, { key: 'inbox', tone: 'info', count: inbox, title: `${plural(inbox, 'unread conversation')}`, body: 'Guest messages waiting for a reply.', target: '/communication/inbox' });

  // Today lists open maintenance alongside the day's tasks (operations/today.ts), so its count does too.
  return json({
    channels, today: ops ? n.today + n.maintenance : 0, maintenance: ops ? n.maintenance : 0, inbox,
    statements: money ? n.statements : 0, approvals, approvalsOn, alerts,
  });
};
